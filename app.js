/**
 * Snore Detector - Main Application
 * Audio recording, analysis, and visualization
 */

class SnoreDetector {
    constructor() {
        // Audio state
        this.mediaRecorder = null;
        this.audioContext = null;
        this.analyser = null;
        this.microphone = null;
        this.isRecording = false;

        // Recording data
        this.startTime = null;
        this.timerInterval = null;
        this.analysisInterval = null;

        // Snore detection configuration
        this.snoreThreshold = 60; // dB threshold for visual indication
        this.maxVolume = 0;

        // Time-series data for chart (stored every 1 second)
        this.decibelHistory = [];
        this.chartInterval = 1000; // 1 second
        this.lastChartUpdate = 0;
        this.currentSecondMaxDb = 0;
        this.currentSecondSumDb = 0;
        this.currentSecondSamples = 0;

        // Wake Lock (prevent screen sleep)
        this.wakeLock = null;

        // Chart
        this.chart = null;

        // DOM Elements
        this.elements = {
            statusCard: document.getElementById('statusCard'),
            statusIcon: document.getElementById('statusIcon'),
            statusTitle: document.getElementById('statusTitle'),
            statusDesc: document.getElementById('statusDesc'),
            recordingTime: document.getElementById('recordingTime'),
            elapsedTime: document.getElementById('elapsedTime'),
            visualizerSection: document.getElementById('visualizerSection'),
            volumeBar: document.getElementById('volumeBar'),
            snoreCount: document.getElementById('snoreCount'),
            maxVolume: document.getElementById('maxVolume'),
            startBtn: document.getElementById('startBtn'),
            stopBtn: document.getElementById('stopBtn'),
            resultsSection: document.getElementById('resultsSection'),
            totalTime: document.getElementById('totalTime'),
            totalTime: document.getElementById('totalTime'),
            avgVolume: document.getElementById('totalSnores'), // Reusing element ID
            maxVolumeResult: document.getElementById('snoreDuration'), // Reusing element ID
            severity: document.getElementById('severity'),
            severityCard: document.getElementById('severityCard'),
            eventsList: document.getElementById('eventsList'),
            newRecordingBtn: document.getElementById('newRecordingBtn'),
            newRecordingBtn: document.getElementById('newRecordingBtn'),
            downloadBtn: document.getElementById('downloadBtn'),
            // Sleep Mode Elements
            sleepOverlay: document.getElementById('sleepOverlay'),
            sleepTime: document.getElementById('sleepTime'),
            sleepStopBtn: document.getElementById('sleepStopBtn')
        };

        this.sleepModeTimeout = null;

        this.init();
    }

    init() {
        this.elements.startBtn.addEventListener('click', () => this.startRecording());
        this.elements.stopBtn.addEventListener('click', () => this.stopRecording());
        this.elements.newRecordingBtn.addEventListener('click', () => this.resetForNewRecording());
        this.elements.downloadBtn.addEventListener('click', () => this.downloadResults());

        // Sleep Mode Interactions
        this.elements.sleepOverlay.addEventListener('click', (e) => {
            if (e.target === this.elements.sleepOverlay || e.target.closest('.sleep-content')) {
                this.toggleSleepVisibility();
            }
        });

        this.elements.sleepStopBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.stopRecording();
        });

        // Re-acquire wake lock when page becomes visible again
        document.addEventListener('visibilitychange', async () => {
            if (this.isRecording && document.visibilityState === 'visible') {
                await this.requestWakeLock();
            }
        });
    }

    async requestWakeLock() {
        if ('wakeLock' in navigator) {
            try {
                this.wakeLock = await navigator.wakeLock.request('screen');
                console.log('Wake Lock activated - screen will stay on');

                this.wakeLock.addEventListener('release', () => {
                    console.log('Wake Lock released');
                });
            } catch (err) {
                console.log('Wake Lock failed:', err.message);
            }
        } else {
            console.log('Wake Lock API not supported - screen may turn off');
            // Show warning to user
            this.elements.statusDesc.textContent = '⚠️ 화면을 켜둔 상태로 유지해주세요';
        }
    }

    releaseWakeLock() {
        if (this.wakeLock) {
            this.wakeLock.release();
            this.wakeLock = null;
        }
    }

    async startRecording() {
        try {
            // Request microphone access
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            });

            // Set up audio context for analysis
            // Set up audio context for analysis
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                this.analyser = this.audioContext.createAnalyser();
                this.analyser.fftSize = 2048;
                this.analyser.smoothingTimeConstant = 0.8;
            }

            // Ensure AudioContext is running
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            this.microphone = this.audioContext.createMediaStreamSource(stream);
            this.microphone.connect(this.analyser);

            // Reset data
            this.decibelHistory = [];
            this.maxVolume = 0;
            this.lastChartUpdate = Date.now();
            this.currentSecondMaxDb = 0;
            this.currentSecondSumDb = 0;
            this.currentSecondSamples = 0;

            // Start recording
            this.isRecording = true;
            this.startTime = Date.now();

            // Request Wake Lock to prevent screen sleep
            await this.requestWakeLock();

            // Update UI
            this.updateUIForRecording();

            // Activate Sleep Mode after 3 minutes (180000 ms)
            // Save timeout ID to clear it if stopped early
            this.sleepModeTimer = setTimeout(() => this.activateSleepMode(), 180000);

            // Start timer
            this.timerInterval = setInterval(() => this.updateTimer(), 1000);

            // Start audio analysis
            this.analysisInterval = setInterval(() => this.analyzeAudio(), 100);

        } catch (error) {
            console.error('Error starting recording:', error);
            alert('마이크 접근 권한이 필요합니다.\n브라우저 설정에서 마이크 권한을 허용해주세요.');
        }
    }

    stopRecording() {
        this.isRecording = false;

        // Stop intervals
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        if (this.analysisInterval) {
            clearInterval(this.analysisInterval);
            this.analysisInterval = null;
        }

        // Close audio context
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        // Release Wake Lock
        this.releaseWakeLock();

        // Clear sleep mode initialization timer
        if (this.sleepModeTimer) {
            clearTimeout(this.sleepModeTimer);
            this.sleepModeTimer = null;
        }

        // Deactivate Sleep Mode
        this.deactivateSleepMode();

        // Finish any ongoing snore
        // Add final time period to chart
        this.addTimeSeriesPoint();

        // Show results
        this.showResults();
    }

    analyzeAudio() {
        if (!this.analyser || !this.isRecording) return;

        const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteFrequencyData(dataArray);

        // Calculate volume (RMS)
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / dataArray.length);

        // Convert to dB (approximate)
        const volume = Math.max(0, Math.min(100, rms));
        const volumeDb = Math.round(20 * Math.log10(rms + 1));

        // Update max volume for session
        if (volumeDb > this.maxVolume) {
            this.maxVolume = volumeDb;
            this.elements.maxVolume.textContent = volumeDb;
        }

        // Track for current second stats
        this.currentSecondSamples++;
        this.currentSecondSumDb += volumeDb;
        if (volumeDb > this.currentSecondMaxDb) {
            this.currentSecondMaxDb = volumeDb;
        }

        // Update volume bar
        this.elements.volumeBar.style.width = `${volume}%`;

        // Visual indication if loud
        if (volumeDb > this.snoreThreshold) {
            this.elements.volumeBar.style.backgroundColor = 'var(--danger)';
        } else {
            this.elements.volumeBar.style.backgroundColor = ''; // Reset to gradient
        }

        // Update time series data every 1 second
        const now = Date.now();
        if (now - this.lastChartUpdate >= this.chartInterval) {
            this.addTimeSeriesPoint();
            this.lastChartUpdate = now;
        }
    }

    // Removed endSnoreEvent method

    addTimeSeriesPoint() {
        const elapsed = Date.now() - this.startTime;

        // Calculate average for this second
        const avgDb = this.currentSecondSamples > 0
            ? Math.round(this.currentSecondSumDb / this.currentSecondSamples)
            : 0;

        this.decibelHistory.push({
            time: elapsed,
            avg: avgDb,
            max: this.currentSecondMaxDb
        });

        // Reset for next second
        this.currentSecondMaxDb = 0;
        this.currentSecondSumDb = 0;
        this.currentSecondSamples = 0;
    }

    updateTimer() {
        const elapsed = Date.now() - this.startTime;
        const formattedTime = this.formatDuration(elapsed);
        this.elements.elapsedTime.textContent = formattedTime;
        this.elements.sleepTime.textContent = formattedTime;
    }

    updateUIForRecording() {
        this.elements.statusCard.classList.add('recording');
        this.elements.statusIcon.textContent = 'mic';
        this.elements.statusTitle.textContent = '녹음 중...';
        this.elements.statusDesc.textContent = '수면 중 소리를 감지하고 있습니다';
        this.elements.recordingTime.style.display = 'flex';
        this.elements.visualizerSection.style.display = 'block';
        this.elements.startBtn.style.display = 'none';
        this.elements.stopBtn.style.display = 'inline-flex';
        this.elements.resultsSection.style.display = 'none';
    }

    showResults() {
        const totalDuration = Date.now() - this.startTime;

        // Calculate average volume
        const totalSum = this.decibelHistory.reduce((sum, item) => sum + item.avg, 0);
        const avgVolume = this.decibelHistory.length > 0
            ? Math.round(totalSum / this.decibelHistory.length)
            : 0;

        // Update UI
        this.elements.statusCard.classList.remove('recording');
        this.elements.statusIcon.textContent = 'check_circle';
        this.elements.statusTitle.textContent = '분석 완료';
        this.elements.statusDesc.textContent = '수면 소리 패턴을 확인하세요';
        this.elements.recordingTime.style.display = 'none';
        this.elements.visualizerSection.style.display = 'none';
        this.elements.startBtn.style.display = 'none';
        this.elements.stopBtn.style.display = 'none';
        this.elements.resultsSection.style.display = 'block';

        // Summary data
        this.elements.totalTime.textContent = this.formatDurationLong(totalDuration);
        this.elements.avgVolume.textContent = `${avgVolume} dB`;
        this.elements.maxVolumeResult.textContent = `${this.maxVolume} dB`;

        // Update labels
        document.querySelector('.summary-card:nth-child(2) .summary-label').textContent = '평균 소음';
        document.querySelector('.summary-card:nth-child(3) .summary-label').textContent = '최대 소음';

        // Severity assessment based on average noise and peaks
        // > 40dB average is considered noisy sleep
        // > 60dB peaks indicate snoring/loud noise
        const loudPeriods = this.decibelHistory.filter(d => d.max > 60).length;
        const loudPercentage = (loudPeriods / this.decibelHistory.length) * 100;

        let severity = '조용함';
        let severityClass = '';

        if (loudPercentage > 30) {
            severity = '시끄러움';
            severityClass = 'danger';
        } else if (loudPercentage > 10) {
            severity = '보통';
            severityClass = 'warning';
        } else if (avgVolume > 40) { // Ambient noise is usually 30-40dB
            severity = '약간 소음';
            severityClass = 'warning';
        }

        this.elements.severity.textContent = severity;
        this.elements.severityCard.className = `summary-card severity ${severityClass}`;

        // Render events list - show loudest moments
        this.renderLoudestMoments();

        // Create chart
        this.createChart();
    }

    renderLoudestMoments() {
        const list = this.elements.eventsList;
        list.parentElement.querySelector('h4').innerHTML = '<span class="material-symbols-outlined">volume_up</span> 가장 시끄러웠던 순간들';
        list.innerHTML = '';

        if (this.decibelHistory.length === 0) return;

        // Find top 10 loudest moments
        const loudestMoments = [...this.decibelHistory]
            .sort((a, b) => b.max - a.max)
            .slice(0, 10)
            .filter(item => item.max > 50); // Show only if louder than 50dB

        if (loudestMoments.length === 0) {
            list.innerHTML = '<div class="event-item">특별히 시끄러운 순간이 없었습니다</div>';
            return;
        }

        loudestMoments.sort((a, b) => a.time - b.time); // Sort by time again

        loudestMoments.forEach(item => {
            const el = document.createElement('div');
            el.className = 'event-item';

            let intensityClass = 'low';
            if (item.max > 70) intensityClass = 'high';
            else if (item.max > 60) intensityClass = 'medium';

            el.innerHTML = `
                <span class="event-time">${this.formatDuration(item.time)}</span>
                <span class="event-duration">${item.max} dB</span>
                <span class="event-intensity ${intensityClass}">
                    ${intensityClass === 'high' ? '매우 큼' : intensityClass === 'medium' ? '큼' : '보통'}
                </span>
            `;
            list.appendChild(el);
        });
    }

    createChart() {
        const ctx = document.getElementById('snoreChart').getContext('2d');

        // Destroy existing chart
        if (this.chart) {
            this.chart.destroy();
        }

        // Downsample data if too many points (limit to ~300 points for performance)
        let chartData = this.decibelHistory;
        if (chartData.length > 600) {
            const factor = Math.ceil(chartData.length / 300);
            chartData = [];
            for (let i = 0; i < this.decibelHistory.length; i += factor) {
                const chunk = this.decibelHistory.slice(i, i + factor);
                const avg = chunk.reduce((sum, item) => sum + item.avg, 0) / chunk.length;
                const max = Math.max(...chunk.map(item => item.max));
                chartData.push({
                    time: this.decibelHistory[i].time,
                    avg: avg,
                    max: max
                });
            }
        }

        // Prepare data
        const labels = chartData.map(d => this.formatDuration(d.time));
        const maxData = chartData.map(d => d.max);
        const avgData = chartData.map(d => d.avg);

        // Create gradient
        const gradient = ctx.createLinearGradient(0, 0, 0, 250);
        gradient.addColorStop(0, 'rgba(255, 118, 117, 0.5)'); // Red-ish for loud
        gradient.addColorStop(1, 'rgba(108, 92, 231, 0.1)'); // Purple-ish for quiet

        // Debug: Log data to console to verify
        console.log('Chart Data Points:', chartData.length);
        if (chartData.length > 0) {
            console.log('Sample Data:', chartData[0]);
        }

        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: '최대 소음',
                        data: maxData,
                        borderColor: '#ff7675',
                        backgroundColor: gradient,
                        borderWidth: 1.5,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 0,
                        pointHitRadius: 10
                    },
                    {
                        label: '평균 소음',
                        data: avgData,
                        borderColor: '#6c5ce7',
                        borderWidth: 1.5,
                        fill: false,
                        tension: 0.4,
                        pointRadius: 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: {
                        display: true,
                        labels: { color: '#a29bfe' }
                    },
                    tooltip: {
                        backgroundColor: '#2d2d4a',
                        titleColor: '#fff',
                        bodyColor: '#a29bfe',
                        borderColor: '#6c5ce7',
                        borderWidth: 1,
                        callbacks: {
                            label: function (context) {
                                return context.dataset.label + ': ' + Math.round(context.raw);
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: {
                            color: 'rgba(255, 255, 255, 0.5)',
                            maxTicksLimit: 8
                        }
                    },
                    y: {
                        beginAtZero: true,
                        suggestedMax: 100,
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: 'rgba(255, 255, 255, 0.5)' },
                        title: {
                            display: true,
                            text: '소리 크기 (dB)',
                            color: 'rgba(255, 255, 255, 0.3)'
                        }
                    }
                }
            }
        });
    }

    resetForNewRecording() {
        this.elements.statusCard.classList.remove('recording');
        this.elements.statusIcon.textContent = 'mic_off';
        this.elements.statusTitle.textContent = '녹음 대기 중';
        this.elements.statusDesc.textContent = '시작 버튼을 눌러 수면 녹음을 시작하세요';
        this.elements.recordingTime.style.display = 'none';
        this.elements.visualizerSection.style.display = 'none';
        this.elements.startBtn.style.display = 'inline-flex';
        this.elements.stopBtn.style.display = 'none';
        this.elements.resultsSection.style.display = 'none';
        this.elements.snoreCount.textContent = '0';
        this.elements.maxVolume.textContent = '0';
        this.elements.volumeBar.style.width = '0%';

        // Reset stored data
        this.decibelHistory = [];
        this.maxVolume = 0;
    }

    downloadResults() {
        const totalDuration = Date.now() - this.startTime;

        // Calculate average volume
        const totalSum = this.decibelHistory.reduce((sum, item) => sum + item.avg, 0);
        const avgVolume = this.decibelHistory.length > 0
            ? Math.round(totalSum / this.decibelHistory.length)
            : 0;

        // Find loudest moments
        const loudestMoments = [...this.decibelHistory]
            .sort((a, b) => b.max - a.max)
            .slice(0, 20)
            .filter(item => item.max > 50)
            .map(item => ({
                time: this.formatDuration(item.time),
                volume: item.max + ' dB'
            }));

        const report = {
            date: new Date().toLocaleString('ko-KR'),
            totalDuration: this.formatDurationLong(totalDuration),
            averageVolume: avgVolume + ' dB',
            maxVolume: this.maxVolume + ' dB',
            loudestMoments: loudestMoments,
            timeSeriesData: this.decibelHistory.map(d => ({
                time: this.formatDuration(d.time),
                avgDb: d.avg,
                maxDb: d.max
            }))
        };

        const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `snore_report_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    formatDurationLong(ms) {
        const seconds = Math.floor(ms / 1000);
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);

        if (hours > 0) {
            return `${hours}시간 ${mins}분`;
        }
        return `${mins}분`;
    }

    // Sleep Mode Methods
    activateSleepMode() {
        this.elements.sleepOverlay.classList.add('active');
        // Hide content initially
        this.elements.sleepOverlay.classList.remove('visible');
    }

    deactivateSleepMode() {
        this.elements.sleepOverlay.classList.remove('active');
        this.elements.sleepOverlay.classList.remove('visible');

        if (this.sleepModeTimeout) {
            clearTimeout(this.sleepModeTimeout);
            this.sleepModeTimeout = null;
        }
    }

    toggleSleepVisibility() {
        this.elements.sleepOverlay.classList.add('visible');

        if (this.sleepModeTimeout) {
            clearTimeout(this.sleepModeTimeout);
        }

        // Hide again after 3 seconds of inactivity
        this.sleepModeTimeout = setTimeout(() => {
            if (this.isRecording) {
                this.elements.sleepOverlay.classList.remove('visible');
            }
        }, 3000);
    }
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    window.snoreDetector = new SnoreDetector();
});
