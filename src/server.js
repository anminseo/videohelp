const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const VideoDownloader = require('./videoDownloader');

const app = express();
const port = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../public')));

// 创建下载器实例
const downloader = new VideoDownloader({
    verbose: true
});

// 存储下载状态
let downloadStatus = {
    status: 'idle',
    progress: 0,
    speed: '',
    eta: '',
    error: null
};

// 获取视频信息
app.get('/api/info', async (req, res) => {
    try {
        const { url } = req.query;
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        const info = await downloader.getInfo(url);
        res.json({
            title: info.title,
            description: info.description,
            thumbnail: info.thumbnail,
            duration: info.duration
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 开始下载
app.get('/api/download', async (req, res) => {
    const { url } = req.query;
    
    // 设置SSE响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const downloader = new VideoDownloader();
    
    // 设置事件监听
    downloader.on('progress', (info) => {
        res.write(`data: ${JSON.stringify(info)}\n\n`);
    });

    try {
        await downloader.download(url);
        res.write('data: {"status": "complete"}\n\n');
        res.end();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 获取下载进度
app.get('/api/progress', (req, res) => {
    res.json(downloadStatus);
});

// 启动服务器
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
}); 