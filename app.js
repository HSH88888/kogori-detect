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
            dbDisk: document.getElementById('dbDisk'), // Changed from dbRing
            thresholdSlider: document.getElementById('thresholdSlider'),
            thresholdValue: document.getElementById('thresholdValue'),
            ticksContainer: document.getElementById('ticks'),

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
        // Create Ticks
        this.createTicks();

        // Event Listeners
        this.elements.startAppBtn.addEventListener('click', () => this.startRecording());
        this.elements.stopBtn.addEventListener('click', () => this.stopRecording());
        this.elements.newRecordingBtn.addEventListener('click', () => this.resetApp());
        this.elements.downloadBtn.addEventListener('click', () => this.downloadResults());

        // Detail View Toggle
        this.elements.showDetailBtn.addEventListener('click', () => {
            this.elements.detailScreen.style.display = 'block';

            // Render chart only when visible to prevent sizing issues
            this.renderChart();

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

        // Chart Controls
        document.querySelectorAll('.btn-xs').forEach(btn => {
            btn.addEventListener('click', (e) => {
                // Update active state
                document.querySelectorAll('.btn-xs').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');

                // Render with new unit
                const unit = e.target.dataset.unit;
                this.renderChart(unit === 'all' ? 'all' : parseInt(unit));
            });
        });

        // Initialize UI State
        this.updateThreshold(this.snoreThreshold);

        // Set Today's Date
        const today = new Date();
        this.elements.resultDate.textContent = `${today.getFullYear()}. ${today.getMonth() + 1}. ${today.getDate()}`;
    }

    createTicks() {
        if (!this.elements.ticksContainer) return;
        this.elements.ticksContainer.innerHTML = '';
        for (let i = 0; i < 60; i++) {
            const tick = document.createElement('div');
            tick.className = 'tick';
            if (i % 5 === 0) tick.classList.add('major');
            tick.style.transform = `translateX(-50%) rotate(${i * 6}deg)`;
            this.elements.ticksContainer.appendChild(tick);
        }
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
        targetView.style.display = ''; // Reset inline style to let CSS take over (flex or block)
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

            // Advanced Snore Detection Variables
            this.snoreConsecutiveCount = 0; // Frames that look like snore
            this.isSnoring = false;
            this.lastSnoreTime = 0;
            this.snoreEvents = []; // Store actual snore start/end times

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

        // Calculate Average Volume (Approx dB)
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
        }
        const average = sum / bufferLength;
        const volumeDb = Math.round(average * (100 / 255) * 1.5);

        // Update UI
        this.elements.currentDb.textContent = `${volumeDb} dB`;

        // Visualizer (Conic Gradient)
        const degrees = Math.min((volumeDb / 100) * 360, 360);
        let color = 'var(--accent-primary)';
        if (volumeDb > this.snoreThreshold) color = 'var(--danger)';
        this.elements.dbDisk.style.background = `conic-gradient(${color} ${degrees}deg, transparent ${degrees}deg)`;

        // --- Advanced Snore Detection Algorithm ---

        // 1. Calculate Frequency Balance
        // We use sampleRate to find bin indices.
        // Usually sampleRate is 44100 or 48000. fftSize is 2048.
        // Bin size = sampleRate / fftSize ~= 21.5Hz per bin.

        const binSize = this.audioContext.sampleRate / this.analyser.fftSize;

        const lowBandStart = Math.floor(100 / binSize); // 100Hz
        const lowBandEnd = Math.floor(800 / binSize);   // 800Hz (Snore Core)
        const highBandStart = Math.floor(1000 / binSize); // 1000Hz+ (Noise)

        let lowFreqSum = 0;
        let lowFreqCount = 0;
        let highFreqSum = 0;
        let highFreqCount = 0;

        for (let i = lowBandStart; i <= lowBandEnd; i++) {
            lowFreqSum += dataArray[i];
            lowFreqCount++;
        }

        for (let i = highBandStart; i < bufferLength; i++) {
            highFreqSum += dataArray[i];
            highFreqCount++;
        }

        const lowAvg = lowFreqCount > 0 ? lowFreqSum / lowFreqCount : 0;
        const highAvg = highFreqCount > 0 ? highFreqSum / highFreqCount : 0;

        // Ratio: How much stronger is the low freq?
        // Breathing/Snoring is usually low-frequency dominant.
        // Paper rustling or car horns are high-frequency or broadband.
        const isLowFreqDominant = lowAvg > (highAvg * 1.2); // Low must be 20% stronger than high

        // 2. Detection Logic
        const isLoudEnough = volumeDb > this.snoreThreshold;

        if (isLoudEnough && isLowFreqDominant) {
            this.snoreConsecutiveCount++;
        } else {
            // Not snoring now.
            // If we had a long enough sequence, register it.
            // 100ms interval. 5 counts = 0.5 sec.
            if (this.snoreConsecutiveCount >= 5) {
                // Verified Snore Event!
                this.recordSnoreEvent(Date.now() - (this.snoreConsecutiveCount * 100), volumeDb);
            }
            this.snoreConsecutiveCount = 0;
        }

        // --- Data Logging for Chart (Keep 1 sec interval) ---
        const now = Date.now();
        if (this.decibelHistory.length === 0 || now - this.decibelHistory[this.decibelHistory.length - 1].time > 1000) {
            this.decibelHistory.push({
                time: now - this.startTime,
                avg: volumeDb,
                max: volumeDb,
                isSnore: this.snoreConsecutiveCount >= 5 // Mark if this second contained snoring
            });
            if (volumeDb > this.maxVolume) this.maxVolume = volumeDb;
        } else {
            const last = this.decibelHistory[this.decibelHistory.length - 1];
            if (volumeDb > last.max) last.max = volumeDb;
            last.avg = Math.round((last.avg + volumeDb) / 2);
            if (this.snoreConsecutiveCount >= 5) last.isSnore = true;
        }
    }

    // Helper to store specific events
    recordSnoreEvent(timestamp, maxDb) {
        // Prevent duplicate events too close
        const timeSinceLast = Date.now() - this.lastSnoreTime;
        if (timeSinceLast < 1000) return; // Merge close events

        this.lastSnoreTime = Date.now();
        this.snoreEvents.push({
            time: timestamp - this.startTime,
            volume: maxDb
        });
        console.log("Snore Detected at", this.formatDuration(timestamp - this.startTime));
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

        // Determine Severity based on CONFIRMED snore events (Frequency & Duration validated)
        // Count seconds where snoring was detected
        const snoreSeconds = this.decibelHistory.filter(d => d.isSnore).length;
        const snorePercentage = (snoreSeconds / validSamples) * 100;

        let status = '정상', desc = '편안한 수면이었습니다', icon = 'check_circle', color = 'var(--success)';

        // Thresholds adjusted for stricter algorithm
        if (snorePercentage > 5) { // More than 5% of sleep time snoring
            status = '주의'; desc = '코골이가 자주 감지되었습니다'; icon = 'warning'; color = 'var(--warning)';
        }
        if (snorePercentage > 20) {
            status = '심각'; desc = '수면 환경 개선이나 상담이 필요할 수 있습니다'; icon = 'error'; color = 'var(--danger)';
        }

        this.elements.severity.textContent = status;
        this.elements.severity.style.color = color;
        this.elements.statusDesc.textContent = desc;
        this.elements.severityIcon.textContent = icon;
        this.elements.severityIcon.style.color = color;

        // Render List (Chart is rendered when 'Show Details' is clicked)
        this.renderEvents();
    }

    renderChart(unitMinutes = 1) {
        const ctx = document.getElementById('snoreChart').getContext('2d');
        if (this.chart) this.chart.destroy();

        // Aggregate Data
        let chartData = [];

        if (unitMinutes === 'all') {
            // Smart auto-aggregation for 'All' to avoid crash
            const totalDurationMinutes = (this.decibelHistory.length) / 60; // Approx
            if (totalDurationMinutes > 120) unitMinutes = 10;
            else if (totalDurationMinutes > 30) unitMinutes = 1;
            else unitMinutes = 0.1; // 6s aggregation
        }

        const groupSize = Math.max(1, Math.floor(unitMinutes * 60)); // items per group (assuming 1 item = 1 sec)

        if (this.decibelHistory.length > 0) {
            let tempMax = 0;
            let tempSum = 0;
            let count = 0;
            let startTime = this.decibelHistory[0].time;

            for (let i = 0; i < this.decibelHistory.length; i++) {
                const item = this.decibelHistory[i];
                tempMax = Math.max(tempMax, item.max);
                tempSum += item.avg;
                count++;

                // If group filled or last item
                if (count >= groupSize || i === this.decibelHistory.length - 1) {
                    chartData.push({
                        time: startTime,
                        max: tempMax,
                        avg: Math.round(tempSum / count)
                    });

                    // Reset
                    tempMax = 0;
                    tempSum = 0;
                    count = 0;
                    if (i + 1 < this.decibelHistory.length) {
                        startTime = this.decibelHistory[i + 1].time;
                    }
                }
            }
        }

        const labels = chartData.map(d => this.formatDuration(d.time));
        const data = chartData.map(d => d.max);

        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: '최대 소음(dB)',
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
                    tension: 0.3,
                    pointRadius: chartData.length > 50 ? 0 : 3, // Show points only if few data
                    pointHitRadius: 10
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { display: false },
                    y: {
                        beginAtZero: true,
                        max: 100,
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

        // Sort snore events by volume (loudest first) and take top 5
        // If no snoreEvents recorded (very short test), fallback to detected snore segments
        let displayEvents = [];

        if (this.snoreEvents.length > 0) {
            displayEvents = [...this.snoreEvents]
                .sort((a, b) => b.volume - a.volume)
                .slice(0, 5);
        } else {
            // Fallback for compatibility or short tests
            displayEvents = this.decibelHistory
                .filter(d => d.max > this.snoreThreshold && d.isSnore)
                .sort((a, b) => b.max - a.max)
                .slice(0, 5)
                .map(d => ({ time: d.time, volume: d.max }));
        }

        if (displayEvents.length === 0) {
            list.innerHTML = '<div class="event-item" style="justify-content:center; color:var(--text-muted);">감지된 코골이 없음 (편안한 수면)</div>';
            return;
        }

        displayEvents.forEach(m => {
            const div = document.createElement('div');
            div.className = 'event-item';
            div.innerHTML = `
                <span class="event-time">${this.formatDuration(m.time)}</span>
                <span class="event-duration">코골이 감지</span>
                <span class="event-intensity high">${m.volume} dB</span>
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
