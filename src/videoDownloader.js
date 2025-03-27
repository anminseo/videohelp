const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const EventEmitter = require('events');
const { exec } = require("child_process");

/**
 * Video downloader class using yt-dlp
 */
class VideoDownloader extends EventEmitter {
    constructor(options = {}) {
        super();
        this.options = {
            outputDir: path.join(os.homedir(), 'Downloads', 'videohelp-downloads'),
            verbose: false,
            ...options
        };
        
        // 明确FFmpeg路径（Windows系统）
        this.ffmpegPath = path.join(__dirname, '..', 'tools', 'ffmpeg.exe');
        // 其他系统路径处理
        if (os.platform() !== 'win32') {
            this.ffmpegPath = 'ffmpeg'; // 使用系统全局FFmpeg
        }
        
        // Use built-in yt-dlp
        this.ytDlpPath = path.join(__dirname, '..', 'tools', os.platform() === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
        
        // Ensure output directory exists
        if (!fs.existsSync(this.options.outputDir)) {
            fs.mkdirSync(this.options.outputDir, { recursive: true });
        }

        // Simple logger
        this.logger = {
            info: (msg) => console.log(`[INFO] ${msg}`),
            error: (msg) => console.error(`[ERROR] ${msg}`),
            debug: (msg) => this.options.verbose && console.debug(`[DEBUG] ${msg}`),
            warn: (msg) => console.warn(`[WARN] ${msg}`)
        };

        // 验证FFmpeg可执行性
        try {
            fs.accessSync(this.ffmpegPath, fs.constants.X_OK);
            this.logger.info(`FFmpeg路径验证通过: ${this.ffmpegPath}`);
        } catch (error) {
            throw new Error(`FFmpeg不可执行: ${this.ffmpegPath}`);
        }
    }

    /**
     * Open directory
     * @private
     * @param {string} dirPath Directory path
     */
    _openDirectory(dirPath) {
        try {
            if (os.platform() === 'win32') {
                spawn('explorer', [dirPath]);
            } else if (os.platform() === 'darwin') {
                spawn('open', [dirPath]);
            } else {
                spawn('xdg-open', [dirPath]);
            }
        } catch (error) {
            this.logger.error(`Failed to open directory: ${error.message}`);
        }
    }

    /**
     * List available formats
     * @param {string} url Video URL
     * @returns {Promise<Array>} List of available formats
     */
    async listFormats(url) {
        return new Promise((resolve, reject) => {
            this.logger.info(`Listing formats for: ${url}`);
            const args = [
                '--list-formats',
                '--no-warnings',
                '--no-check-certificates',
                '--no-playlist',
                '--no-check-formats',
                '--extractor-args', 'bilibili:formats=missing_pot',
                url
            ];
            
            const ytdlpProcess = spawn(this.ytDlpPath, args, {
                env: {
                    ...process.env,
                    PYTHONIOENCODING: 'utf-8'
                }
            });
            
            let stdout = '';
            let stderr = '';
            
            ytdlpProcess.stdout.on('data', (data) => {
                stdout += data.toString('utf8');
            });
            
            ytdlpProcess.stderr.on('data', (data) => {
                const output = data.toString('utf8');
                if (!output.includes('[debug]')) {
                    stderr += output;
                }
            });
            
            ytdlpProcess.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout);
                } else {
                    reject(new Error(`Failed to list formats: ${stderr.trim()}`));
                }
            });
            
            ytdlpProcess.on('error', (err) => {
                reject(new Error(`Failed to start yt-dlp: ${err.message}`));
            });
        });
    }

    /**
     * Download video
     * @param {string} url Video URL to download
     * @param {string} outputDir Download directory
     * @returns {Promise} Promise that resolves when download is complete
     */
    async download(url, outputDir = this.options.outputDir) {
        return new Promise(async (resolve, reject) => {
            try {
                this.logger.info(`Starting video download: ${url}`);

                // Ensure output directory exists
                if (!fs.existsSync(outputDir)) {
                    fs.mkdirSync(outputDir, { recursive: true });
                }

                // 使用时间戳作为文件名，避免特殊字符
                const timestamp = Date.now();
                const outputPath = path.join(outputDir, `output_${timestamp}.%(ext)s`);

                // Build yt-dlp command
                const args = [
                    '-o', outputPath,
                    '--restrict-filenames',
                    '--no-warnings',
                    '--no-check-certificates',
                    '--verbose',
                    '--progress',
                    '--format', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
                    '--merge-output-format', 'mp4',
                    '--ffmpeg-location', this.ffmpegPath,
                    '--no-playlist',
                    '--no-check-formats',
                    '--extractor-args', 'bilibili:formats=missing_pot',
                    '--force-overwrites',
                    '--postprocessor-args', 'FFmpegMergerPP:-c:v copy -c:a aac -movflags +faststart',
                    url
                ];

                this.logger.debug(`Command-line config: ${JSON.stringify(args)}`);

                // Create yt-dlp process
                const ytDlp = spawn(this.ytDlpPath, args, {
                    stdio: ['pipe', 'pipe', 'pipe'],
                    env: {
                        ...process.env,
                        PYTHONIOENCODING: 'utf-8'
                    }
                });

                // Store download information
                let downloadInfo = {
                    filename: '',
                    progress: 0,
                    speed: '',
                    eta: '',
                    status: 'downloading'
                };

                // Handle output
                ytDlp.stdout.on('data', (data) => {
                    const output = data.toString('utf8');
                    this.logger.debug(output);

                    // 新正则表达式支持更多格式
                    const progressMatch = output.match(/\[download\]\s+([\d.]+)%(?:\s+of\s+~?([\d.]+)(\w+))?\s+at\s+([\d.]+)(\w+)\/s\s+ETA\s+([\d:]+)/);
                    
                    if (progressMatch) {
                        downloadInfo.progress = parseFloat(progressMatch[1]);
                        
                        // 处理可能缺失的总大小信息
                        if (progressMatch[2] && progressMatch[3]) {
                            downloadInfo.totalSize = `${progressMatch[2]} ${progressMatch[3]}`;
                        }
                        
                        downloadInfo.speed = `${progressMatch[4]} ${progressMatch[5]}/s`;
                        downloadInfo.eta = progressMatch[6];
                        this.emit('progress', downloadInfo);
                    }
                    // 添加备用的百分比匹配
                    else {
                        const simpleProgress = output.match(/\[download\]\s+([\d.]+)%/);
                        if (simpleProgress) {
                            downloadInfo.progress = parseFloat(simpleProgress[1]);
                            this.emit('progress', downloadInfo);
                        }
                    }

                    // Parse filename
                    const filenameMatch = output.match(/\[download\]\s+Destination:\s+(.+)/);
                    if (filenameMatch) {
                        downloadInfo.filename = filenameMatch[1];
                    }
                });

                // Handle error output
                ytDlp.stderr.on('data', (data) => {
                    const output = data.toString('utf8');
                    // Only log actual errors, not debug messages
                    if (!output.includes('[debug]')) {
                        this.logger.error(`yt-dlp error: ${output}`);
                    }
                });

                // Handle process error
                ytDlp.on('error', (err) => {
                    this.logger.error(`yt-dlp process error: ${err.message}`);
                    this.emit('error', err);
                    reject(err);
                });

                // Handle process exit
                ytDlp.on('close', async (code) => {
                    if (code === 0) {
                        this.logger.info(`Download completed: ${downloadInfo.filename}`);
                        this.emit('complete', downloadInfo);
                        // Open download directory
                        this._openDirectory(outputDir);
                        resolve(downloadInfo);
                    } else {
                        // 尝试查找已下载的分离文件并合并
                        try {
                            const files = fs.readdirSync(outputDir);
                            
                            // 查找可能的视频和音频文件
                            const videoFiles = files.filter(file => 
                                file.includes('.mp4') && 
                                (file.includes('f') || file.includes('video'))
                            );
                            
                            const audioFiles = files.filter(file => 
                                (file.includes('.m4a') || file.includes('.aac') || file.includes('.ogg')) && 
                                (file.includes('f') || file.includes('audio'))
                            );
                            
                            this.logger.info(`找到视频文件: ${videoFiles.length}个, 音频文件: ${audioFiles.length}个`);
                            
                            // 如果找到了视频和音频文件，尝试合并
                            if (videoFiles.length > 0 && audioFiles.length > 0) {
                                // 选择最新的文件（通常是当前下载的）
                                const videoFile = videoFiles[0];
                                const audioFile = audioFiles[0];
                                
                                // 创建简单的临时文件名
                                const tempVideoName = `temp_video_${timestamp}.mp4`;
                                const tempAudioName = `temp_audio_${timestamp}.m4a`;
                                const outputName = `output_${timestamp}.mp4`;
                                
                                // 重命名文件
                                const oldVideoPath = path.join(outputDir, videoFile);
                                const oldAudioPath = path.join(outputDir, audioFile);
                                const newVideoPath = path.join(outputDir, tempVideoName);
                                const newAudioPath = path.join(outputDir, tempAudioName);
                                
                                try {
                                    fs.renameSync(oldVideoPath, newVideoPath);
                                    fs.renameSync(oldAudioPath, newAudioPath);
                                    this.logger.info(`文件重命名成功`);
                                } catch (renameErr) {
                                    this.logger.error(`文件重命名失败: ${renameErr.message}`);
                                    reject(renameErr);
                                    return;
                                }
                                
                                this.logger.info(`尝试合并文件: ${tempVideoName} + ${tempAudioName} -> ${outputName}`);
                                
                                await this.mergeFiles(
                                    newVideoPath,
                                    newAudioPath,
                                    path.join(outputDir, outputName)
                                );
                                
                                downloadInfo.filename = outputName;
                                this.logger.info(`合并成功: ${outputName}`);
                                this.emit('complete', downloadInfo);
                                
                                // 清理临时文件
                                try {
                                    fs.unlinkSync(newVideoPath);
                                    fs.unlinkSync(newAudioPath);
                                    this.logger.info('已删除临时文件');
                                } catch (deleteErr) {
                                    this.logger.warn(`删除临时文件失败: ${deleteErr.message}`);
                                }
                                
                                // 打开下载目录
                                this._openDirectory(outputDir);
                                resolve(downloadInfo);
                                return;
                            }
                        } catch (mergeError) {
                            this.logger.error(`合并文件时出错: ${mergeError.message}`);
                        }
                        
                        const error = new Error(`yt-dlp failed with exit code: ${code}`);
                        this.logger.error(error.message);
                        this.emit('error', error);
                        reject(error);
                    }
                });
            } catch (error) {
                this.logger.error(`Download process error: ${error.message}`);
                this.emit('error', error);
                reject(error);
            }
        });
    }

    /**
     * Get video information
     * @param {string} url Video URL
     * @returns {Promise<object>} Video information
     */
    getInfo(url) {
        return new Promise((resolve, reject) => {
            this.logger.info(`Fetching video information: ${url}`);
            const args = [
                '--dump-json',
                '--no-warnings',
                '--no-check-certificates',
                '--no-playlist',
                '--no-check-formats',
                '--extractor-args', 'bilibili:formats=missing_pot',
                url
            ];
            
            const ytdlpProcess = spawn(this.ytDlpPath, args, {
                env: {
                    ...process.env,
                    PYTHONIOENCODING: 'utf-8'
                }
            });
            
            let stdout = '';
            let stderr = '';
            
            ytdlpProcess.stdout.on('data', (data) => {
                stdout += data.toString('utf8');
            });
            
            ytdlpProcess.stderr.on('data', (data) => {
                const output = data.toString('utf8');
                // Only log actual errors, not debug messages
                if (!output.includes('[debug]')) {
                    stderr += output;
                }
            });
            
            ytdlpProcess.on('close', (code) => {
                if (code === 0) {
                    try {
                        const info = JSON.parse(stdout);
                        this.logger.info(`Successfully fetched video information: ${info.title}`);
                        resolve(info);
                    } catch (error) {
                        this.logger.error('Failed to parse video information:', error);
                        reject(new Error('Failed to parse video information'));
                    }
                } else {
                    this.logger.error(`Failed to fetch video information: ${stderr.trim()}`);
                    reject(new Error(`Failed to fetch video information: ${stderr.trim()}`));
                }
            });
            
            ytdlpProcess.on('error', (err) => {
                this.logger.error('Failed to start yt-dlp:', err);
                reject(new Error(`Failed to start yt-dlp: ${err.message}`));
            });
        });
    }

    /**
     * Check yt-dlp version
     * @returns {Promise<string>} Version number
     */
    getVersion() {
        return new Promise((resolve, reject) => {
            const args = ['--version'];
            
            const ytdlpProcess = spawn(this.ytDlpPath, args);
            
            let stdout = '';
            let stderr = '';
            
            ytdlpProcess.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            
            ytdlpProcess.stderr.on('data', (data) => {
                const output = data.toString();
                // Only log actual errors, not debug messages
                if (!output.includes('[debug]')) {
                    stderr += output;
                }
            });
            
            ytdlpProcess.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout.trim());
                } else {
                    reject(new Error(`Failed to get version: ${stderr.trim()}`));
                }
            });
            
            ytdlpProcess.on('error', (err) => {
                reject(new Error(`Failed to start yt-dlp: ${err.message}`));
            });
        });
    }
    
    /**
     * Manually merge video and audio files
     * @param {string} videoFile Video file path
     * @param {string} audioFile Audio file path
     * @param {string} outputFile Output file path
     * @returns {Promise<boolean>} Success status
     */
    async mergeFiles(videoFile, audioFile, outputFile) {
        return new Promise((resolve, reject) => {
            let tempDir;
            try {
                // 创建简单临时目录（避免短路径）
                tempDir = path.join(os.tmpdir(), `dl_${Date.now()}`);
                fs.mkdirSync(tempDir, { recursive: true });

                // 使用简单文件名
                const tempVideo = path.join(tempDir, "v.mp4");
                const tempAudio = path.join(tempDir, "a.m4a");
                const tempOutput = path.join(tempDir, "out.mp4");

                // 复制文件（添加错误处理）
                try {
                    fs.copyFileSync(videoFile, tempVideo);
                    fs.copyFileSync(audioFile, tempAudio);
                } catch (copyError) {
                    throw new Error(`文件复制失败: ${copyError.message}`);
                }

                // 构建FFmpeg命令（使用绝对路径）
                const args = [
                    '-y',
                    '-i', `"${tempVideo}"`, // 添加引号包裹路径
                    '-i', `"${tempAudio}"`,
                    '-c:v', 'copy',
                    '-c:a', 'copy',
                    `"${tempOutput}"`
                ];

                this.logger.debug(`执行FFmpeg命令: ${this.ffmpegPath} ${args.join(' ')}`);

                const ffmpegProcess = spawn(`"${this.ffmpegPath}"`, args, {
                    shell: true, // 启用shell模式处理路径
                    windowsVerbatimArguments: false
                });

                // 收集错误输出
                let errorOutput = '';
                ffmpegProcess.stderr.on('data', (data) => {
                    errorOutput += data.toString();
                });

                // 处理进程关闭
                ffmpegProcess.on('close', (code) => {
                    if (code === 0) {
                        fs.copyFileSync(tempOutput, outputFile);
                        fs.rmSync(tempDir, { recursive: true, force: true });
                        resolve(true);
                    } else {
                        this.logger.error(`FFmpeg错误详情:\n${errorOutput}`);
                        fs.rmSync(tempDir, { recursive: true, force: true });
                        reject(new Error(`合并失败 (code ${code})，请检查音频视频格式是否兼容`));
                    }
                });

            } catch (error) {
                if (tempDir && fs.existsSync(tempDir)) {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                }
                reject(error);
            }
        });
    }

    static checkFFmpeg() {
        const ffmpegPath = path.join(__dirname, '..', 'tools', 'ffmpeg.exe');
        try {
            const version = execSync(`"${ffmpegPath}" -version`).toString();
            console.log('FFmpeg版本信息:\n', version.split('\n')[0]);
        } catch (error) {
            console.error('FFmpeg检查失败:', error.message);
        }
    }
}

module.exports = VideoDownloader; 