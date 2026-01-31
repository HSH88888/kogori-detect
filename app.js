class SnoreDetector {
    constructor() {
        this.audioContext = null;
        this.analyser = null;
        this.microphone = null;
        this.isRecording = false;
        this.startTime = null;
        this.decibelHistory = [];
        this.snoreThreshold = 30; // Default 30dB
        this.maxVolume = 0;

        // Timer references
        this.analysisInterval = null;
        this.timerInterval = null;
        this.sleepModeTimer = null;
        this.wakeLock = null;

        // UI Elements Cache
        this.elements = {
            // Views
            homeView: document.getElementById('homeView'),
            recordingView: document.getElementById('recordingView'),
            resultsView: document.getElementById('resultsView'),

            // Buttons
            startAppBtn: document.getElementById('startAppBtn'),
            stopBtn: document.getElementById('stopBtn'),
            newRecordingBtn: document.getElementById('newRecordingBtn'),
            downloadBtn: document.getElementById('downloadBtn'),
            showDetailBtn: document.getElementById('showDetailBtn'),

            // Recording UI
            recordingTime: document.getElementById('recordingTime'),
            currentDb: document.getElementById('currentDb'),
            dbRing: document.getElementById('dbRing'),
            thresholdSlider: document.getElementById('thresholdSlider'),
            thresholdValue: document.getElementById('thresholdValue'),

            // Results UI
            resultDate: document.getElementById('resultDate'),
            severityIcon: document.getElementById('severityIcon'),
            severity: document.getElementById('severity'),
            statusDesc: document.getElementById('statusDesc'),
            totalTime: document.getElementById('totalTime'),
            avgVolume: document.getElementById('avgVolume'),
            maxVolumeResult: document.getElementById('maxVolumeResult'),
            detailScreen: document.getElementById('detailScreen'),
            eventsList: document.getElementById('eventsList'),

            // Sleep Mode
            sleepOverlay: document.getElementById('sleepOverlay'),
            sleepTime: document.getElementById('sleepTime'),
            sleepStopBtn: document.getElementById('sleepStopBtn')
        };

        this.chart = null;
        this.init();
    }

    init() {
        // Event Listeners
        this.elements.startAppBtn.addEventListener('click', () => this.startRecording());
        this.elements.stopBtn.addEventListener('click', () => this.stopRecording());
        this.elements.newRecordingBtn.addEventListener('click', () => this.resetApp());
        this.elements.downloadBtn.addEventListener('click', () => this.downloadResults());

        // Detail View Toggle
        this.elements.showDetailBtn.addEventListener('click', () => {
            this.elements.detailScreen.style.display = 'block';
            setTimeout(() => {
                this.elements.detailScreen.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);
            this.elements.showDetailBtn.style.display = 'none'; // Hide button after click
        });

        // Settings Slider
        this.elements.thresholdSlider.addEventListener('input', (e) => {
            this.updateThreshold(parseInt(e.target.value));
        });

        // Sleep Mode Interactions
        this.elements.sleepOverlay.addEventListener('click', () => {
            this.tempWakeSleepMode();
        });

        this.elements.sleepStopBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.stopRecording();
        });

        // Initialize UI State
        this.updateThreshold(this.snoreThreshold);

        // Set Today's Date
        const today = new Date();
        this.elements.resultDate.textContent = `${today.getFullYear()}. ${today.getMonth() + 1}. ${today.getDate()}`;
    }

    // View Navigation Logic
    switchView(viewId) {
        // Hide all views first
        document.querySelectorAll('.view').forEach(view => {
            view.classList.remove('active');
            setTimeout(() => {
                if (!view.classList.contains('active')) view.style.display = 'none';
            }, 300); // Wait for transition
        });

        // Show target view
        const targetView = document.getElementById(viewId);
        targetView.style.display = 'flex';
        // Small delay to trigger opacity transition
        setTimeout(() => {
            targetView.classList.add('active');
        }, 50);
    }

    resetApp() {
        this.switchView('homeView');
        // Reset Result UI state
        setTimeout(() => {
            this.elements.detailScreen.style.display = 'none';
            this.elements.showDetailBtn.style.display = 'flex';
            window.scrollTo(0, 0);
        }, 300);
    }

    updateThreshold(value) {
        this.snoreThreshold = value;
        this.elements.thresholdValue.textContent = `${value} dB`;
        this.elements.thresholdSlider.value = value;
    }

    // Recording Logic
    async startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
            });

            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                this.analyser = this.audioContext.createAnalyser();
                this.analyser.fftSize = 2048;
                this.analyser.smoothingTimeConstant = 0.8;
            }

            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            this.microphone = this.audioContext.createMediaStreamSource(stream);
            this.microphone.connect(this.analyser);

            // Reset Data
            this.decibelHistory = [];
            this.maxVolume = 0;
            this.isRecording = true;
            this.startTime = Date.now();

            // Update UI
            this.switchView('recordingView');
            this.requestWakeLock();

            // Start Timers
            // Activate sleep mode after 3 minutes
            this.sleepModeTimer = setTimeout(() => this.activateSleepMode(), 180000);

            this.timerInterval = setInterval(() => this.updateTimer(), 1000);
            this.analysisInterval = setInterval(() => this.analyzeAudio(), 100);

        } catch (error) {
            console.error(error);
            alert('마이크 사용 권한이 필요합니다. 브라우저 설정에서 권한을 허용해주세요.');
        }
    }

    stopRecording() {
        if (!this.isRecording) return;
        this.isRecording = false;

        // Stop intervals
        clearInterval(this.timerInterval);
        clearInterval(this.analysisInterval);
        clearTimeout(this.sleepModeTimer);

        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        this.releaseWakeLock();
        this.deactivateSleepMode();

        // Process & Show Results
        this.processResults();
        this.switchView('resultsView');
    }

    analyzeAudio() {
        if (!this.isRecording) return;

        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        this.analyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
        }
        const average = sum / bufferLength;
        // Approximate dB calculation
        const volumeDb = Math.round(average * (100 / 255) * 1.5);

        // Update UI Text
        this.elements.currentDb.textContent = `${volumeDb} dB`;

        // Update Ring Visualization
        // Stroke-dasharray is 283. 
        // 0dB -> stroke-dashoffset: 283 (Empty)
        // 100dB -> stroke-dashoffset: 0 (Full)
        const maxOffset = 283;
        const offset = maxOffset - (Math.min(volumeDb, 100) / 100 * maxOffset);
        this.elements.dbRing.style.strokeDashoffset = offset;

        // Change color based on threshold
        if (volumeDb > this.snoreThreshold) {
            this.elements.dbRing.style.stroke = 'var(--danger)'; // Red
        } else {
            this.elements.dbRing.style.stroke = 'var(--accent-primary)'; // Purple
        }

        // Store Data Logic (Sample once per second)
        const now = Date.now();
        if (this.decibelHistory.length === 0 || now - this.decibelHistory[this.decibelHistory.length - 1].time > 1000) {
            this.decibelHistory.push({
                time: now - this.startTime,
                avg: volumeDb,
                max: volumeDb
            });

            // Track global max
            if (volumeDb > this.maxVolume) this.maxVolume = volumeDb;
        } else {
            // Update current second max
            const last = this.decibelHistory[this.decibelHistory.length - 1];
            if (volumeDb > last.max) last.max = volumeDb;
            // Simple running average update
            last.avg = Math.round((last.avg + volumeDb) / 2);
        }
    }

    updateTimer() {
        const diff = Date.now() - this.startTime;
        const timeStr = this.formatDuration(diff);
        this.elements.recordingTime.textContent = timeStr;
        this.elements.sleepTime.textContent = timeStr;
    }

    formatDuration(ms) {
        const totalHelpers = Math.floor(ms / 1000);
        const h = Math.floor(totalHelpers / 3600);
        const m = Math.floor((totalHelpers % 3600) / 60);
        const s = totalHelpers % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    processResults() {
        const durationMs = Date.now() - this.startTime;
        const h = Math.floor(durationMs / 3600000);
        const m = Math.floor((durationMs % 3600000) / 60000);
        this.elements.totalTime.textContent = `${h}시간 ${m}분`;

        // Calc Stats
        const validSamples = this.decibelHistory.length;
        if (validSamples === 0) return;

        const avgDb = Math.round(this.decibelHistory.reduce((a, b) => a + b.avg, 0) / validSamples);
        const maxDb = this.maxVolume;

        this.elements.avgVolume.textContent = `${avgDb} dB`;
        this.elements.maxVolumeResult.textContent = `${maxDb} dB`;

        // Determine Severity based on loud noise percentage
        const loudSamples = this.decibelHistory.filter(d => d.max > 40).length; // simple baseline
        const snorePercentage = (loudSamples / validSamples) * 100;

        let status = '정상', desc = '편안한 수면이었습니다', icon = 'check_circle', color = 'var(--success)';

        if (snorePercentage > 15) {
            status = '주의'; desc = '코골이가 자주 감지되었습니다'; icon = 'warning'; color = 'var(--warning)';
        }
        if (snorePercentage > 40) {
            status = '심각'; desc = '수면 환경 개선이나 상담이 필요할 수 있습니다'; icon = 'error'; color = 'var(--danger)';
        }

        this.elements.severity.textContent = status;
        this.elements.severity.style.color = color;
        this.elements.statusDesc.textContent = desc;
        this.elements.severityIcon.textContent = icon;
        this.elements.severityIcon.style.color = color;

        // Render Chart & List
        this.renderChart();
        this.renderEvents();
    }

    renderChart() {
        const ctx = document.getElementById('snoreChart').getContext('2d');
        if (this.chart) this.chart.destroy();

        // Formatting labels: only show specific intervals to avoid clutter
        const labels = this.decibelHistory.map(d => this.formatDuration(d.time));
        const data = this.decibelHistory.map(d => d.max);

        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: '소음(dB)',
                    data: data,
                    borderColor: '#6c5ce7',
                    backgroundColor: (context) => {
                        const ctx = context.chart.ctx;
                        const gradient = ctx.createLinearGradient(0, 0, 0, 200);
                        gradient.addColorStop(0, 'rgba(108, 92, 231, 0.5)');
                        gradient.addColorStop(1, 'rgba(108, 92, 231, 0.0)');
                        return gradient;
                    },
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHitRadius: 10
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { display: false }, // Hide x axis labels for clean look
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: 'rgba(255,255,255,0.5)' }
                    }
                }
            }
        });
    }

    renderEvents() {
        const list = this.elements.eventsList;
        list.innerHTML = '';

        // Find top 5 loudest moments > threshold
        const loudMoments = this.decibelHistory
            .filter(d => d.max > this.snoreThreshold)
            .sort((a, b) => b.max - a.max)
            .slice(0, 5);

        if (loudMoments.length === 0) {
            list.innerHTML = '<div class="event-item" style="justify-content:center; color:var(--text-muted);">감지된 큰 소음이 없습니다</div>';
            return;
        }

        loudMoments.forEach(m => {
            const div = document.createElement('div');
            div.className = 'event-item';
            div.innerHTML = `
                <span class="event-time">${this.formatDuration(m.time)}</span>
                <span class="event-duration">시점</span>
                <span class="event-intensity high">${m.max} dB</span>
            `;
            list.appendChild(div);
        });
    }

    downloadResults() {
        const data = {
            date: new Date().toISOString(),
            duration: this.formatDuration(Date.now() - this.startTime),
            maxVolume: this.maxVolume,
            history: this.decibelHistory
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `snore-result-${Date.now()}.json`;
        a.click();
    }

    // Wake Lock
    async requestWakeLock() {
        try { if ('wakeLock' in navigator) this.wakeLock = await navigator.wakeLock.request('screen'); }
        catch (err) { console.log('Wake Lock Error', err); }
    }
    releaseWakeLock() {
        if (this.wakeLock) { this.wakeLock.release(); this.wakeLock = null; }
    }

    // Sleep Overlay
    activateSleepMode() {
        this.elements.sleepOverlay.classList.add('active');
        setTimeout(() => this.elements.sleepOverlay.classList.add('visible'), 50);
    }
    deactivateSleepMode() {
        this.elements.sleepOverlay.classList.remove('visible');
        setTimeout(() => this.elements.sleepOverlay.classList.remove('active'), 300);
    }
    tempWakeSleepMode() {
        this.elements.sleepOverlay.classList.remove('visible');
        setTimeout(() => {
            if (this.isRecording) this.elements.sleepOverlay.classList.add('visible');
        }, 3000); // Re-dim after 3 seconds
    }
}

// Start App
const app = new SnoreDetector();
