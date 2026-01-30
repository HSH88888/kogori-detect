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

        // Snore detection
        this.snoreThreshold = 60; // dB threshold for snore detection
        this.snoreEvents = [];
        this.currentSnoreStart = null;
        this.snoreCount = 0;
        this.maxVolume = 0;

        // Time-series data for chart (every 30 seconds)
        this.timeSeriesData = [];
        this.chartInterval = 30000; // 30 seconds
        this.lastChartUpdate = 0;
        this.currentPeriodSnores = 0;

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
            totalSnores: document.getElementById('totalSnores'),
            snoreDuration: document.getElementById('snoreDuration'),
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
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 2048;
            this.analyser.smoothingTimeConstant = 0.8;

            this.microphone = this.audioContext.createMediaStreamSource(stream);
            this.microphone.connect(this.analyser);

            // Reset data
            this.snoreEvents = [];
            this.timeSeriesData = [];
            this.snoreCount = 0;
            this.maxVolume = 0;
            this.currentSnoreStart = null;
            this.lastChartUpdate = Date.now();
            this.currentPeriodSnores = 0;

            // Start recording
            this.isRecording = true;
            this.startTime = Date.now();

            // Request Wake Lock to prevent screen sleep
            await this.requestWakeLock();

            // Update UI
            this.updateUIForRecording();

            // Activate Sleep Mode after 3 seconds
            setTimeout(() => this.activateSleepMode(), 3000);

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

        // Deactivate Sleep Mode
        this.deactivateSleepMode();

        // Finish any ongoing snore
        if (this.currentSnoreStart) {
            this.endSnoreEvent();
        }

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

        // Update max volume
        if (volumeDb > this.maxVolume) {
            this.maxVolume = volumeDb;
            this.elements.maxVolume.textContent = volumeDb;
        }

        // Update volume bar
        this.elements.volumeBar.style.width = `${volume}%`;

        // Snore detection
        const isSnoring = volume > this.snoreThreshold;

        if (isSnoring && !this.currentSnoreStart) {
            // Start new snore event
            this.currentSnoreStart = Date.now();
        } else if (!isSnoring && this.currentSnoreStart) {
            // End snore event (if it lasted more than 0.5 seconds)
            const duration = Date.now() - this.currentSnoreStart;
            if (duration > 500) {
                this.endSnoreEvent();
            } else {
                this.currentSnoreStart = null; // Too short, ignore
            }
        }

        // Update time series data every 30 seconds
        const now = Date.now();
        if (now - this.lastChartUpdate >= this.chartInterval) {
            this.addTimeSeriesPoint();
            this.lastChartUpdate = now;
            this.currentPeriodSnores = 0;
        }
    }

    endSnoreEvent() {
        if (!this.currentSnoreStart) return;

        const endTime = Date.now();
        const duration = endTime - this.currentSnoreStart;
        const elapsed = this.currentSnoreStart - this.startTime;

        // Determine intensity based on duration
        let intensity = 'low';
        if (duration > 5000) intensity = 'high';
        else if (duration > 2000) intensity = 'medium';

        this.snoreEvents.push({
            startTime: elapsed,
            duration: duration,
            intensity: intensity
        });

        this.snoreCount++;
        this.currentPeriodSnores++;
        this.elements.snoreCount.textContent = this.snoreCount;

        this.currentSnoreStart = null;
    }

    addTimeSeriesPoint() {
        const elapsed = Date.now() - this.startTime;
        this.timeSeriesData.push({
            time: elapsed,
            snores: this.currentPeriodSnores
        });
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
        const totalSnoreDuration = this.snoreEvents.reduce((sum, e) => sum + e.duration, 0);

        // Update UI
        this.elements.statusCard.classList.remove('recording');
        this.elements.statusIcon.textContent = 'check_circle';
        this.elements.statusTitle.textContent = '분석 완료';
        this.elements.statusDesc.textContent = '수면 분석 결과를 확인하세요';
        this.elements.recordingTime.style.display = 'none';
        this.elements.visualizerSection.style.display = 'none';
        this.elements.startBtn.style.display = 'none';
        this.elements.stopBtn.style.display = 'none';
        this.elements.resultsSection.style.display = 'block';

        // Summary data
        this.elements.totalTime.textContent = this.formatDurationLong(totalDuration);
        this.elements.totalSnores.textContent = `${this.snoreCount}회`;
        this.elements.snoreDuration.textContent = this.formatDurationLong(totalSnoreDuration);

        // Severity assessment
        const snorePercentage = (totalSnoreDuration / totalDuration) * 100;
        let severity = '정상';
        let severityClass = '';

        if (snorePercentage > 20) {
            severity = '심각';
            severityClass = 'danger';
        } else if (snorePercentage > 10) {
            severity = '주의';
            severityClass = 'warning';
        } else if (snorePercentage > 5) {
            severity = '경미';
            severityClass = 'warning';
        }

        this.elements.severity.textContent = severity;
        this.elements.severityCard.className = `summary-card severity ${severityClass}`;

        // Render events list
        this.renderEventsList();

        // Create chart
        this.createChart();
    }

    renderEventsList() {
        const list = this.elements.eventsList;
        list.innerHTML = '';

        if (this.snoreEvents.length === 0) {
            list.innerHTML = '<div class="event-item">코골이가 감지되지 않았습니다</div>';
            return;
        }

        // Show last 20 events
        const events = this.snoreEvents.slice(-20).reverse();

        events.forEach(event => {
            const item = document.createElement('div');
            item.className = 'event-item';
            item.innerHTML = `
                <span class="event-time">${this.formatDuration(event.startTime)}</span>
                <span class="event-duration">${(event.duration / 1000).toFixed(1)}초</span>
                <span class="event-intensity ${event.intensity}">
                    ${event.intensity === 'high' ? '강함' : event.intensity === 'medium' ? '보통' : '약함'}
                </span>
            `;
            list.appendChild(item);
        });
    }

    createChart() {
        const ctx = document.getElementById('snoreChart').getContext('2d');

        // Destroy existing chart
        if (this.chart) {
            this.chart.destroy();
        }

        // Prepare data
        const labels = this.timeSeriesData.map((d, i) => {
            return this.formatDuration(d.time);
        });

        const data = this.timeSeriesData.map(d => d.snores);

        // Create gradient
        const gradient = ctx.createLinearGradient(0, 0, 0, 200);
        gradient.addColorStop(0, 'rgba(108, 92, 231, 0.8)');
        gradient.addColorStop(1, 'rgba(108, 92, 231, 0.1)');

        this.chart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: '코골이 횟수',
                    data: data,
                    backgroundColor: gradient,
                    borderColor: '#6c5ce7',
                    borderWidth: 2,
                    borderRadius: 6,
                    borderSkipped: false
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: '#2d2d4a',
                        titleColor: '#fff',
                        bodyColor: '#a29bfe',
                        borderColor: '#6c5ce7',
                        borderWidth: 1,
                        cornerRadius: 8,
                        padding: 12
                    }
                },
                scales: {
                    x: {
                        grid: {
                            color: 'rgba(255, 255, 255, 0.05)'
                        },
                        ticks: {
                            color: 'rgba(255, 255, 255, 0.5)',
                            maxRotation: 45
                        }
                    },
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: 'rgba(255, 255, 255, 0.05)'
                        },
                        ticks: {
                            color: 'rgba(255, 255, 255, 0.5)',
                            stepSize: 1
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
    }

    downloadResults() {
        const totalDuration = Date.now() - this.startTime;
        const totalSnoreDuration = this.snoreEvents.reduce((sum, e) => sum + e.duration, 0);

        const report = {
            date: new Date().toLocaleString('ko-KR'),
            totalDuration: this.formatDurationLong(totalDuration),
            snoreCount: this.snoreCount,
            snoreDuration: this.formatDurationLong(totalSnoreDuration),
            snorePercentage: ((totalSnoreDuration / totalDuration) * 100).toFixed(1) + '%',
            events: this.snoreEvents.map(e => ({
                time: this.formatDuration(e.startTime),
                duration: (e.duration / 1000).toFixed(1) + '초',
                intensity: e.intensity
            })),
            timeSeriesData: this.timeSeriesData.map(d => ({
                time: this.formatDuration(d.time),
                snores: d.snores
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
