document.addEventListener('DOMContentLoaded', () => {
    const urlInput = document.getElementById('url');
    const fetchBtn = document.getElementById('fetch');
    const downloadBtn = document.getElementById('download');
    const infoContainer = document.getElementById('info');
    const progressContainer = document.getElementById('progress');
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');
    const speedText = document.getElementById('speed');
    const etaText = document.getElementById('eta');
    const errorMessage = document.getElementById('error');
    const thumbnail = document.getElementById('thumbnail');
    const title = document.getElementById('title');
    const description = document.getElementById('description');
    const duration = document.getElementById('duration');

    let currentUrl = '';

    // Format duration
    function formatDuration(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remainingSeconds = seconds % 60;
        
        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
        }
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }

    // Show error message
    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.style.display = 'block';
        infoContainer.style.display = 'none';
        progressContainer.style.display = 'none';
    }

    // Hide error message
    function hideError() {
        errorMessage.style.display = 'none';
    }

    // Update progress
    function updateProgress(progress, speed, eta) {
        progressBar.style.width = `${progress}%`;
        progressText.textContent = `${progress.toFixed(1)}%`;
        speedText.textContent = speed;
        etaText.textContent = `ETA: ${eta}`;
    }

    // Get video information
    fetchBtn.addEventListener('click', async () => {
        const url = urlInput.value.trim();
        if (!url) {
            showError('Please enter a video URL');
            return;
        }
        
        try {
            hideError();
            fetchBtn.disabled = true;
            fetchBtn.textContent = 'Loading...';

            const response = await fetch(`/api/info?url=${encodeURIComponent(url)}`);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to fetch video information');
            }

            currentUrl = url;
            thumbnail.src = data.thumbnail;
            title.textContent = data.title;
            description.textContent = data.description;
            duration.textContent = `Duration: ${formatDuration(data.duration)}`;

            infoContainer.style.display = 'block';
            progressContainer.style.display = 'none';
        } catch (error) {
            showError(error.message);
        } finally {
            fetchBtn.disabled = false;
            fetchBtn.textContent = 'Get Info';
        }
    });

    // Start download
    downloadBtn.addEventListener('click', async () => {
        if (!currentUrl) {
            showError('Please fetch video information first');
            return;
        }

        try {
            hideError();
            downloadBtn.disabled = true;
            downloadBtn.textContent = 'Downloading...';
            progressContainer.style.display = 'block';

            // 使用EventSource接收进度更新
            const eventSource = new EventSource(`/api/download?url=${encodeURIComponent(currentUrl)}`);

            eventSource.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (data.status === 'complete') {
                    eventSource.close();
                    showError('Download completed successfully!');
                    downloadBtn.disabled = false;
                    downloadBtn.textContent = 'Start Download';
                } else {
                    updateProgress(data.progress, data.speed, data.eta);
                }
            };

            eventSource.onerror = (error) => {
                eventSource.close();
                showError('Download failed');
                downloadBtn.disabled = false;
                downloadBtn.textContent = 'Start Download';
            };
        } catch (error) {
            console.error('下载失败:', error);
            showError(error.message);
            downloadBtn.disabled = false;
            downloadBtn.textContent = 'Start Download';
        }
    });
}); 