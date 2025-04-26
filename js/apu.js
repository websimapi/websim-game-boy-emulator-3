export class APU {
    constructor(mmu) {
        this.mmu = mmu;
        
        // Audio context and nodes
        this.audioContext = null;
        this.masterGain = null;
        
        // Channel components
        this.channels = {
            // Channel 1 - Pulse with sweep
            1: {
                enabled: false,
                dac: false,
                frequency: 0,
                volumeEnvelope: { volume: 0, direction: 0, period: 0, timer: 0 },
                sweep: { enabled: false, period: 0, direction: 0, shift: 0, timer: 0, shadowFreq: 0 },
                timer: 0,
                lengthCounter: 0,
                lengthEnabled: false,
                wavePosition: 0,
                duty: 0,
                dutyPattern: [0x01, 0x81, 0x87, 0x7E], // 12.5%, 25%, 50%, 75%
                output: 0,
                oscillator: null,
                gain: null
            },
            
            // Channel 2 - Pulse
            2: {
                enabled: false,
                dac: false,
                frequency: 0,
                volumeEnvelope: { volume: 0, direction: 0, period: 0, timer: 0 },
                timer: 0,
                lengthCounter: 0,
                lengthEnabled: false,
                wavePosition: 0,
                duty: 0,
                dutyPattern: [0x01, 0x81, 0x87, 0x7E], // Same as channel 1
                output: 0,
                oscillator: null,
                gain: null
            },
            
            // Channel 3 - Wave
            3: {
                enabled: false,
                dac: false,
                frequency: 0,
                timer: 0,
                lengthCounter: 0,
                lengthEnabled: false,
                wavePosition: 0,
                volumeShift: 0, // 0=100%, 1=50%, 2=25%, 3=12.5%
                waveTable: new Uint8Array(16).fill(0),
                output: 0,
                oscillator: null,
                gain: null
            },
            
            // Channel 4 - Noise
            4: {
                enabled: false,
                dac: false,
                volumeEnvelope: { volume: 0, direction: 0, period: 0, timer: 0 },
                timer: 0,
                lengthCounter: 0,
                lengthEnabled: false,
                shiftFrequency: 0,
                divRatioCode: 0,
                widthMode: 0,
                lfsr: 0x7FFF, // Linear feedback shift register
                output: 0,
                oscillator: null,
                gain: null
            }
        };
        
        // Master control
        this.enabled = false;
        this.leftVolume = 7;
        this.rightVolume = 7;
        this.leftEnabled = [false, false, false, false];
        this.rightEnabled = [false, false, false, false];
        
        // Frame sequencer
        this.frameSequencerStep = 0;
        this.frameSequencerCounter = 0;
        
        // Audio buffer for Web Audio API
        this.sampleBuffer = [];
        this.sampleRate = 44100;
        this.samplesPerFrame = Math.floor(this.sampleRate / 60); // Assuming 60fps
        this.initialized = false;
    }
    
    reset() {
        // Reset all channels and registers
        this.channels[1].enabled = false;
        this.channels[2].enabled = false;
        this.channels[3].enabled = false;
        this.channels[4].enabled = false;
        
        this.frameSequencerStep = 0;
        this.frameSequencerCounter = 0;
        
        // Initial register values
        this.writeRegister(0xFF10, 0x80); // NR10
        this.writeRegister(0xFF11, 0xBF); // NR11
        this.writeRegister(0xFF12, 0xF3); // NR12
        this.writeRegister(0xFF13, 0xFF); // NR13
        this.writeRegister(0xFF14, 0xBF); // NR14
        
        this.writeRegister(0xFF16, 0x3F); // NR21
        this.writeRegister(0xFF17, 0x00); // NR22
        this.writeRegister(0xFF18, 0xFF); // NR23
        this.writeRegister(0xFF19, 0xBF); // NR24
        
        this.writeRegister(0xFF1A, 0x7F); // NR30
        this.writeRegister(0xFF1B, 0xFF); // NR31
        this.writeRegister(0xFF1C, 0x9F); // NR32
        this.writeRegister(0xFF1D, 0xFF); // NR33
        this.writeRegister(0xFF1E, 0xBF); // NR34
        
        this.writeRegister(0xFF20, 0xFF); // NR41
        this.writeRegister(0xFF21, 0x00); // NR42
        this.writeRegister(0xFF22, 0x00); // NR43
        this.writeRegister(0xFF23, 0xBF); // NR44
        
        this.writeRegister(0xFF24, 0x77); // NR50
        this.writeRegister(0xFF25, 0xF3); // NR51
        this.writeRegister(0xFF26, 0xF1); // NR52
        
        // Clear wave table
        for (let i = 0; i < 16; i++) {
            this.channels[3].waveTable[i] = 0;
        }
    }
    
    // Initialize Web Audio API
    initAudio() {
        if (this.initialized) return;
        
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.sampleRate = this.audioContext.sampleRate;
            this.samplesPerFrame = Math.floor(this.sampleRate / 60);
            
            // Create master gain control
            this.masterGain = this.audioContext.createGain();
            this.masterGain.gain.value = 0.1; // Adjust overall volume
            this.masterGain.connect(this.audioContext.destination);
            
            // Set up each channel's oscillator and gain
            this.setupChannel(1, 'square');
            this.setupChannel(2, 'square');
            this.setupChannel(3, 'custom'); // Wave channel
            this.setupChannel(4, 'noise');
            
            this.initialized = true;
        } catch (e) {
            console.error('Failed to initialize Web Audio API:', e);
        }
    }
    
    // Set up audio nodes for a channel
    setupChannel(channelNum, type) {
        const channel = this.channels[channelNum];
        
        // Create gain node for the channel
        channel.gain = this.audioContext.createGain();
        channel.gain.gain.value = 0;
        channel.gain.connect(this.masterGain);
        
        // Create oscillator based on type
        if (type === 'square') {
            channel.oscillator = this.audioContext.createOscillator();
            channel.oscillator.type = 'square';
        } else if (type === 'custom') {
            // Wave channel - create oscillator and set custom wave
            channel.oscillator = this.audioContext.createOscillator();
            this.updateWaveTable(channel);
        } else if (type === 'noise') {
            // Noise channel - for now, we'll use white noise via audio buffer
            channel.oscillator = this.audioContext.createBufferSource();
            this.createNoiseBuffer(channel);
            channel.oscillator.loop = true;
        }
        
        channel.oscillator.connect(channel.gain);
        channel.oscillator.start();
    }
    
    // Update the wave table for channel 3
    updateWaveTable(channel) {
        try {
            // Convert 4-bit wave table to real waveform
            const real = new Float32Array(33);
            const imag = new Float32Array(33);
            real[0] = 0; // DC offset
            imag[0] = 0;
            
            // Create waveform data
            for (let i = 0; i < 16; i++) {
                const val = channel.waveTable[i];
                const high = (val >> 4) / 7.5 - 1; // Convert 0-15 to -1 to 1
                const low = (val & 0xF) / 7.5 - 1;
                
                // Add harmonics for each sample point
                real[i + 1] = (high + low) / 2; // Average for smoother wave
                imag[i + 1] = 0;
            }
            
            // Create and set the periodic wave
            const wave = this.audioContext.createPeriodicWave(real, imag);
            channel.oscillator.setPeriodicWave(wave);
        } catch (e) {
            console.error('Error updating wave table:', e);
        }
    }
    
    // Create a noise buffer for channel 4
    createNoiseBuffer(channel) {
        const bufferSize = this.audioContext.sampleRate;
        const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const data = buffer.getChannelData(0);
        
        // Fill with random values for white noise
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        
        channel.oscillator.buffer = buffer;
    }
    
    // Start audio playback
    start() {
        this.initAudio();
        
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
    }
    
    // Pause audio playback
    pause() {
        if (this.audioContext && this.audioContext.state === 'running') {
            this.audioContext.suspend();
        }
    }
    
    // Resume audio playback
    resume() {
        if (this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
    }
    
    // Stop audio playback
    stop() {
        if (this.audioContext) {
            this.audioContext.suspend();
        }
    }
    
    // Read an APU register
    readRegister(address) {
        switch (address) {
            case 0xFF10: // NR10
                return (this.channels[1].sweep.period << 4) |
                       (this.channels[1].sweep.direction << 3) |
                       (this.channels[1].sweep.shift) | 0x80;
                
            case 0xFF11: // NR11
                return (this.channels[1].duty << 6) | 0x3F;
                
            case 0xFF12: // NR12
                return (this.channels[1].volumeEnvelope.volume << 4) |
                       (this.channels[1].volumeEnvelope.direction << 3) |
                       (this.channels[1].volumeEnvelope.period);
                
            case 0xFF13: // NR13
                return 0xFF; // Write-only
                
            case 0xFF14: // NR14
                return (this.channels[1].lengthEnabled ? 0x40 : 0) | 0xBF;
                
            case 0xFF16: // NR21
                return (this.channels[2].duty << 6) | 0x3F;
                
            case 0xFF17: // NR22
                return (this.channels[2].volumeEnvelope.volume << 4) |
                       (this.channels[2].volumeEnvelope.direction << 3) |
                       (this.channels[2].volumeEnvelope.period);
                
            case 0xFF18: // NR23
                return 0xFF; // Write-only
                
            case 0xFF19: // NR24
                return (this.channels[2].lengthEnabled ? 0x40 : 0) | 0xBF;
                
            case 0xFF1A: // NR30
                return (this.channels[3].dac ? 0x80 : 0) | 0x7F;
                
            case 0xFF1B: // NR31
                return 0xFF; // Write-only
                
            case 0xFF1C: // NR32
                return (this.channels[3].volumeShift << 5) | 0x9F;
                
            case 0xFF1D: // NR33
                return 0xFF; // Write-only
                
            case 0xFF1E: // NR34
                return (this.channels[3].lengthEnabled ? 0x40 : 0) | 0xBF;
                
            case 0xFF20: // NR41
                return 0xFF; // Write-only
                
            case 0xFF21: // NR42
                return (this.channels[4].volumeEnvelope.volume << 4) |
                       (this.channels[4].volumeEnvelope.direction << 3) |
                       (this.channels[4].volumeEnvelope.period);
                
            case 0xFF22: // NR43
                return (this.channels[4].shiftFrequency << 4) |
                       (this.channels[4].widthMode << 3) |
                       (this.channels[4].divRatioCode);
                
            case 0xFF23: // NR44
                return (this.channels[4].lengthEnabled ? 0x40 : 0) | 0xBF;
                
            case 0xFF24: // NR50
                return (this.rightVolume) |
                       (this.leftVolume << 4);
                
            case 0xFF25: // NR51
                return (this.rightEnabled[0] ? 0x01 : 0) |
                       (this.rightEnabled[1] ? 0x02 : 0) |
                       (this.rightEnabled[2] ? 0x04 : 0) |
                       (this.rightEnabled[3] ? 0x08 : 0) |
                       (this.leftEnabled[0] ? 0x10 : 0) |
                       (this.leftEnabled[1] ? 0x20 : 0) |
                       (this.leftEnabled[2] ? 0x40 : 0) |
                       (this.leftEnabled[3] ? 0x80 : 0);
                
            case 0xFF26: // NR52
                return (this.enabled ? 0x80 : 0) |
                       (this.channels[1].enabled ? 0x01 : 0) |
                       (this.channels[2].enabled ? 0x02 : 0) |
                       (this.channels[3].enabled ? 0x04 : 0) |
                       (this.channels[4].enabled ? 0x08 : 0) |
                       0xF0;
                
            // Wave pattern RAM
            case 0xFF30: case 0xFF31: case 0xFF32: case 0xFF33: 
            case 0xFF34: case 0xFF35: case 0xFF36: case 0xFF37: 
            case 0xFF38: case 0xFF39: case 0xFF3A: case 0xFF3B: 
            case 0xFF3C: case 0xFF3D: case 0xFF3E: case 0xFF3F:
                return this.channels[3].waveTable[address - 0xFF30];
                
            default:
                return 0xFF;
        }
    }
    
    // Write to an APU register
    writeRegister(address, value) {
        if (!this.enabled && address !== 0xFF26 && (address < 0xFF30 || address > 0xFF3F)) {
            // If APU is disabled, only NR52 and wave RAM can be written
            return;
        }
        
        switch (address) {
            // Channel 1 - Pulse with sweep
            case 0xFF10: // NR10 - Sweep
                this.channels[1].sweep.period = (value >> 4) & 0x07;
                this.channels[1].sweep.direction = (value >> 3) & 0x01;
                this.channels[1].sweep.shift = value & 0x07;
                break;
                
            case 0xFF11: // NR11 - Length timer & duty
                this.channels[1].duty = (value >> 6) & 0x03;
                this.channels[1].lengthCounter = 64 - (value & 0x3F);
                this.updateChannel1Duty();
                break;
                
            case 0xFF12: // NR12 - Volume & envelope
                this.channels[1].volumeEnvelope.volume = (value >> 4) & 0x0F;
                this.channels[1].volumeEnvelope.direction = (value >> 3) & 0x01;
                this.channels[1].volumeEnvelope.period = value & 0x07;
                
                // Check if DAC is enabled
                this.channels[1].dac = (value & 0xF8) !== 0;
                if (!this.channels[1].dac) {
                    this.channels[1].enabled = false;
                }
                break;
                
            case 0xFF13: // NR13 - Frequency LSB
                this.channels[1].frequency = (this.channels[1].frequency & 0x700) | value;
                this.updateChannel1Frequency();
                break;
                
            case 0xFF14: // NR14 - Frequency MSB & control
                this.channels[1].frequency = (this.channels[1].frequency & 0xFF) | ((value & 0x07) << 8);
                this.channels[1].lengthEnabled = (value & 0x40) !== 0;
                
                if (value & 0x80) {
                    this.triggerChannel1();
                }
                
                this.updateChannel1Frequency();
                break;
                
            // Channel 2 - Pulse
            case 0xFF16: // NR21 - Length timer & duty
                this.channels[2].duty = (value >> 6) & 0x03;
                this.channels[2].lengthCounter = 64 - (value & 0x3F);
                this.updateChannel2Duty();
                break;
                
            case 0xFF17: // NR22 - Volume & envelope
                this.channels[2].volumeEnvelope.volume = (value >> 4) & 0x0F;
                this.channels[2].volumeEnvelope.direction = (value >> 3) & 0x01;
                this.channels[2].volumeEnvelope.period = value & 0x07;
                
                // Check if DAC is enabled
                this.channels[2].dac = (value & 0xF8) !== 0;
                if (!this.channels[2].dac) {
                    this.channels[2].enabled = false;
                }
                break;
                
            case 0xFF18: // NR23 - Frequency LSB
                this.channels[2].frequency = (this.channels[2].frequency & 0x700) | value;
                this.updateChannel2Frequency();
                break;
                
            case 0xFF19: // NR24 - Frequency MSB & control
                this.channels[2].frequency = (this.channels[2].frequency & 0xFF) | ((value & 0x07) << 8);
                this.channels[2].lengthEnabled = (value & 0x40) !== 0;
                
                if (value & 0x80) {
                    this.triggerChannel2();
                }
                
                this.updateChannel2Frequency();
                break;
                
            // Channel 3 - Wave
            case 0xFF1A: // NR30 - DAC enable
                this.channels[3].dac = (value & 0x80) !== 0;
                if (!this.channels[3].dac) {
                    this.channels[3].enabled = false;
                }
                break;
                
            case 0xFF1B: // NR31 - Length timer
                this.channels[3].lengthCounter = 256 - value;
                break;
                
            case 0xFF1C: // NR32 - Output level
                this.channels[3].volumeShift = (value >> 5) & 0x03;
                break;
                
            case 0xFF1D: // NR33 - Frequency LSB
                this.channels[3].frequency = (this.channels[3].frequency & 0x700) | value;
                this.updateChannel3Frequency();
                break;
                
            case 0xFF1E: // NR34 - Frequency MSB & control
                this.channels[3].frequency = (this.channels[3].frequency & 0xFF) | ((value & 0x07) << 8);
                this.channels[3].lengthEnabled = (value & 0x40) !== 0;
                
                if (value & 0x80) {
                    this.triggerChannel3();
                }
                
                this.updateChannel3Frequency();
                break;
                
            // Channel 4 - Noise
            case 0xFF20: // NR41 - Length timer
                this.channels[4].lengthCounter = 64 - (value & 0x3F);
                break;
                
            case 0xFF21: // NR42 - Volume & envelope
                this.channels[4].volumeEnvelope.volume = (value >> 4) & 0x0F;
                this.channels[4].volumeEnvelope.direction = (value >> 3) & 0x01;
                this.channels[4].volumeEnvelope.period = value & 0x07;
                
                // Check if DAC is enabled
                this.channels[4].dac = (value & 0xF8) !== 0;
                if (!this.channels[4].dac) {
                    this.channels[4].enabled = false;
                }
                break;
                
            case 0xFF22: // NR43 - Clock shift & width
                this.channels[4].shiftFrequency = (value >> 4) & 0x0F;
                this.channels[4].widthMode = (value >> 3) & 0x01;
                this.channels[4].divRatioCode = value & 0x07;
                this.updateChannel4Frequency();
                break;
                
            case 0xFF23: // NR44 - Control
                this.channels[4].lengthEnabled = (value & 0x40) !== 0;
                
                if (value & 0x80) {
                    this.triggerChannel4();
                }
                break;
                
            // Control registers
            case 0xFF24: // NR50 - Master volume & VIN
                this.rightVolume = value & 0x07;
                this.leftVolume = (value >> 4) & 0x07;
                break;
                
            case 0xFF25: // NR51 - Sound panning
                this.rightEnabled[0] = (value & 0x01) !== 0;
                this.rightEnabled[1] = (value & 0x02) !== 0;
                this.rightEnabled[2] = (value & 0x04) !== 0;
                this.rightEnabled[3] = (value & 0x08) !== 0;
                this.leftEnabled[0] = (value & 0x10) !== 0;
                this.leftEnabled[1] = (value & 0x20) !== 0;
                this.leftEnabled[2] = (value & 0x40) !== 0;
                this.leftEnabled[3] = (value & 0x80) !== 0;
                break;
                
            case 0xFF26: // NR52 - Sound on/off
                const wasEnabled = this.enabled;
                this.enabled = (value & 0x80) !== 0;
                
                if (!this.enabled) {
                    // Power off APU
                    for (let i = 1; i <= 4; i++) {
                        this.channels[i].enabled = false;
                    }
                    this.reset();
                } else if (!wasEnabled) {
                    // Power on APU
                    this.frameSequencerStep = 0;
                }
                break;
                
            // Wave pattern RAM
            case 0xFF30: case 0xFF31: case 0xFF32: case 0xFF33: 
            case 0xFF34: case 0xFF35: case 0xFF36: case 0xFF37: 
            case 0xFF38: case 0xFF39: case 0xFF3A: case 0xFF3B: 
            case 0xFF3C: case 0xFF3D: case 0xFF3E: case 0xFF3F:
                this.channels[3].waveTable[address - 0xFF30] = value;
                break;
        }
    }
    
    // Update channel frequencies and parameters
    updateChannel1Frequency() {
        if (!this.initialized) return;
        
        const frequencyHz = 131072 / (2048 - this.channels[1].frequency);
        this.channels[1].oscillator.frequency.setValueAtTime(frequencyHz, this.audioContext.currentTime);
    }
    
    updateChannel1Duty() {
        if (!this.initialized) return;
        
        // GameBoy uses 12.5%, 25%, 50%, and 75% duty cycles
        const duties = [0.125, 0.25, 0.5, 0.75];
        //this.channels[1].oscillator.setPeriodicWave(this.createDutyWave(duties[this.channels[1].duty]));
    }
    
    updateChannel2Frequency() {
        if (!this.initialized) return;
        
        const frequencyHz = 131072 / (2048 - this.channels[2].frequency);
        this.channels[2].oscillator.frequency.setValueAtTime(frequencyHz, this.audioContext.currentTime);
    }
    
    updateChannel2Duty() {
        if (!this.initialized) return;
        
        const duties = [0.125, 0.25, 0.5, 0.75];
        //this.channels[2].oscillator.setPeriodicWave(this.createDutyWave(duties[this.channels[2].duty]));
    }
    
    updateChannel3Frequency() {
        if (!this.initialized) return;
        
        const frequencyHz = 65536 / (2048 - this.channels[3].frequency);
        this.channels[3].oscillator.frequency.setValueAtTime(frequencyHz, this.audioContext.currentTime);
    }
    
    updateChannel4Frequency() {
        if (!this.initialized) return;
        
        // Noise channel frequency calculation is complex and approximated here
        const divisor = this.channels[4].divRatioCode === 0 ? 8 : this.channels[4].divRatioCode * 16;
        const frequencyHz = 524288 / divisor / Math.pow(2, this.channels[4].shiftFrequency);
        
        // For simplicity, we're using white noise with different frequencies
        // A more accurate approach would involve a custom buffer with LFSR
        //this.channels[4].oscillator.playbackRate.setValueAtTime(frequencyHz / 1000, this.audioContext.currentTime);
    }
    
    // Channel trigger events
    triggerChannel1() {
        if (!this.channels[1].dac) return;
        
        this.channels[1].enabled = true;
        
        if (this.channels[1].lengthCounter === 0) {
            this.channels[1].lengthCounter = 64;
        }
        
        this.channels[1].timer = (2048 - this.channels[1].frequency) * 4;
        
        // Reset envelope
        this.channels[1].volumeEnvelope.timer = this.channels[1].volumeEnvelope.period;
        
        // Reset sweep
        this.channels[1].sweep.timer = this.channels[1].sweep.period > 0 ? this.channels[1].sweep.period : 8;
        this.channels[1].sweep.shadowFreq = this.channels[1].frequency;
        
        if (this.channels[1].sweep.period > 0 || this.channels[1].sweep.shift > 0) {
            this.channels[1].sweep.enabled = true;
        }
        
        if (this.initialized) {
            // Set real volume
            this.channels[1].gain.gain.setValueAtTime(
                this.channels[1].volumeEnvelope.volume / 15 * 0.25, 
                this.audioContext.currentTime
            );
        }
    }
    
    triggerChannel2() {
        if (!this.channels[2].dac) return;
        
        this.channels[2].enabled = true;
        
        if (this.channels[2].lengthCounter === 0) {
            this.channels[2].lengthCounter = 64;
        }
        
        this.channels[2].timer = (2048 - this.channels[2].frequency) * 4;
        
        // Reset envelope
        this.channels[2].volumeEnvelope.timer = this.channels[2].volumeEnvelope.period;
        
        if (this.initialized) {
            // Set real volume
            this.channels[2].gain.gain.setValueAtTime(
                this.channels[2].volumeEnvelope.volume / 15 * 0.25, 
                this.audioContext.currentTime
            );
        }
    }
    
    triggerChannel3() {
        if (!this.channels[3].dac) return;
        
        this.channels[3].enabled = true;
        
        if (this.channels[3].lengthCounter === 0) {
            this.channels[3].lengthCounter = 256;
        }
        
        this.channels[3].timer = (2048 - this.channels[3].frequency) * 2;
        this.channels[3].wavePosition = 0;
        
        if (this.initialized) {
            // Set volume based on volume code
            const volumes = [0, 1/4, 1/2, 3/4];
            this.channels[3].gain.gain.setValueAtTime(
                volumes[this.channels[3].volumeShift] * 0.25, 
                this.audioContext.currentTime
            );
        }
    }
    
    triggerChannel4() {
        if (!this.channels[4].dac) return;
        
        this.channels[4].enabled = true;
        
        if (this.channels[4].lengthCounter === 0) {
            this.channels[4].lengthCounter = 64;
        }
        
        // Reset noise LFSR
        this.channels[4].lfsr = 0x7FFF;
        
        // Reset envelope
        this.channels[4].volumeEnvelope.timer = this.channels[4].volumeEnvelope.period;
        
        if (this.initialized) {
            // Set real volume
            this.channels[4].gain.gain.setValueAtTime(
                this.channels[4].volumeEnvelope.volume / 15 * 0.25, 
                this.audioContext.currentTime
            );
        }
    }
    
    // Step the APU forward by the given number of cycles
    step(cycles) {
        if (!this.enabled) return;
        
        // Accumulate cycles for frame sequencer (512Hz, 8 steps)
        this.frameSequencerCounter += cycles;
        
        while (this.frameSequencerCounter >= 8192) { // 4194304/512 = 8192 cycles per frame sequencer step
            this.frameSequencerCounter -= 8192;
            this.frameSequencer();
        }
        
        // Channel timers
        if (this.channels[1].enabled) {
            this.channels[1].timer -= cycles;
            if (this.channels[1].timer <= 0) {
                this.channels[1].timer += (2048 - this.channels[1].frequency) * 4;
                this.channels[1].wavePosition = (this.channels[1].wavePosition + 1) & 7;
                // Output is 1 if the bit at the current position in the duty pattern is set
                this.channels[1].output = (this.channels[1].dutyPattern[this.channels[1].duty] >> (7 - this.channels[1].wavePosition)) & 1;
            }
        }
        
        if (this.channels[2].enabled) {
            this.channels[2].timer -= cycles;
            if (this.channels[2].timer <= 0) {
                this.channels[2].timer += (2048 - this.channels[2].frequency) * 4;
                this.channels[2].wavePosition = (this.channels[2].wavePosition + 1) & 7;
                this.channels[2].output = (this.channels[2].dutyPattern[this.channels[2].duty] >> (7 - this.channels[2].wavePosition)) & 1;
            }
        }
        
        if (this.channels[3].enabled) {
            this.channels[3].timer -= cycles;
            if (this.channels[3].timer <= 0) {
                this.channels[3].timer += (2048 - this.channels[3].frequency) * 2;
                this.channels[3].wavePosition = (this.channels[3].wavePosition + 1) & 31;
                
                // Get sample from wave table
                const tableSample = this.channels[3].wavePosition >> 1;
                const nibble = this.channels[3].wavePosition & 1 ? this.channels[3].waveTable[tableSample] & 0x0F : this.channels[3].waveTable[tableSample] >> 4;
                
                // Apply volume shift
                const volumeShift = this.channels[3].volumeShift;
                this.channels[3].output = volumeShift === 0 ? nibble : nibble >> (volumeShift - 1);
            }
        }
        
        if (this.channels[4].enabled) {
            this.channels[4].timer -= cycles;
            if (this.channels[4].timer <= 0) {
                // Calculate period
                const divisor = this.channels[4].divRatioCode === 0 ? 8 : this.channels[4].divRatioCode * 16;
                this.channels[4].timer += divisor << this.channels[4].shiftFrequency;
                
                // LFSR algorithm
                const xorResult = (this.channels[4].lfsr & 1) ^ ((this.channels[4].lfsr >> 1) & 1);
                this.channels[4].lfsr = (this.channels[4].lfsr >> 1) | (xorResult << 14);
                
                // If 7-bit mode is enabled, also put the xorResult into bit 6
                if (this.channels[4].widthMode) {
                    this.channels[4].lfsr = (this.channels[4].lfsr & ~0x40) | (xorResult << 6);
                }
                
                // Output is inverted bit 0 of LFSR
                this.channels[4].output = (~this.channels[4].lfsr & 1);
            }
        }
        
        // Generate audio samples if initialized
        if (this.initialized && this.enabled) {
            this.mixAudio();
        }
    }
    
    // Frame sequencer steps
    frameSequencer() {
        // Step 0, 4: Length counter
        if (this.frameSequencerStep === 0 || this.frameSequencerStep === 4) {
            this.lengthCounter();
        }
        
        // Step 2, 6: Sweep
        if (this.frameSequencerStep === 2 || this.frameSequencerStep === 6) {
            this.sweep();
        }
        
        // Step 7: Volume envelope
        if (this.frameSequencerStep === 7) {
            this.volumeEnvelope();
        }
        
        // Advance frame sequencer
        this.frameSequencerStep = (this.frameSequencerStep + 1) % 8;
    }
    
    // Length counter processing
    lengthCounter() {
        for (let ch = 1; ch <= 4; ch++) {
            const channel = this.channels[ch];
            
            if (channel.lengthEnabled && channel.lengthCounter > 0) {
                channel.lengthCounter--;
                
                if (channel.lengthCounter === 0) {
                    channel.enabled = false;
                    
                    if (this.initialized) {
                        channel.gain.gain.setValueAtTime(0, this.audioContext.currentTime);
                    }
                }
            }
        }
    }
    
    // Sweep processing (Channel 1 only)
    sweep() {
        const channel = this.channels[1];
        
        if (channel.sweep.enabled && channel.sweep.period > 0) {
            channel.sweep.timer--;
            
            if (channel.sweep.timer === 0) {
                // Reload timer
                channel.sweep.timer = channel.sweep.period > 0 ? channel.sweep.period : 8;
                
                if (channel.sweep.period > 0) {
                    // Calculate new frequency
                    const newFreq = this.calculateSweep();
                    
                    if (newFreq <= 2047 && channel.sweep.shift > 0) {
                        channel.sweep.shadowFreq = newFreq;
                        channel.frequency = newFreq;
                        this.updateChannel1Frequency();
                        
                        // Calculate again to check for overflow
                        this.calculateSweep();
                    }
                }
            }
        }
    }
    
    // Calculate sweep frequency
    calculateSweep() {
        let newFreq = this.channels[1].sweep.shadowFreq >> this.channels[1].sweep.shift;
        
        if (this.channels[1].sweep.direction === 1) {
            newFreq = this.channels[1].sweep.shadowFreq - newFreq;
        } else {
            newFreq = this.channels[1].sweep.shadowFreq + newFreq;
        }
        
        // Check for overflow
        if (newFreq > 2047) {
            this.channels[1].enabled = false;
            if (this.initialized) {
                this.channels[1].gain.gain.setValueAtTime(0, this.audioContext.currentTime);
            }
        }
        
        return newFreq;
    }
    
    // Volume envelope processing
    volumeEnvelope() {
        // Process volume envelope for channels 1, 2, and 4
        for (let ch of [1, 2, 4]) {
            const channel = this.channels[ch];
            
            if (channel.volumeEnvelope.period > 0) {
                channel.volumeEnvelope.timer--;
                
                if (channel.volumeEnvelope.timer === 0) {
                    channel.volumeEnvelope.timer = channel.volumeEnvelope.period;
                    
                    let newVolume = channel.volumeEnvelope.volume;
                    
                    if (channel.volumeEnvelope.direction === 1) {
                        // Increase
                        if (newVolume < 15) {
                            newVolume++;
                        }
                    } else {
                        // Decrease
                        if (newVolume > 0) {
                            newVolume--;
                        }
                    }
                    
                    if (newVolume !== channel.volumeEnvelope.volume) {
                        channel.volumeEnvelope.volume = newVolume;
                        
                        if (channel.enabled && this.initialized) {
                            channel.gain.gain.setValueAtTime(
                                newVolume / 15 * 0.25, 
                                this.audioContext.currentTime
                            );
                        }
                    }
                }
            }
        }
    }
    
    // Mix audio from all channels
    mixAudio() {
        if (!this.initialized) return;
        
        // Use Web Audio API gain nodes for mixing
        // This is a simplified version - a full implementation would
        // calculate the exact samples and apply proper channel panning
        
        for (let ch = 1; ch <= 4; ch++) {
            const channel = this.channels[ch];
            
            if (channel.enabled) {
                // Check if channel is routed to either output
                const channelEnabled = (this.leftEnabled[ch-1] || this.rightEnabled[ch-1]);
                
                if (channelEnabled) {
                    let volume = 0;
                    
                    if (ch === 3) {
                        // Channel 3 (Wave) uses volume code
                        const volumes = [0, 1/4, 1/2, 3/4];
                        volume = volumes[channel.volumeShift] * 0.25;
                    } else {
                        // Channels 1, 2, 4 use volume envelope
                        volume = channel.volumeEnvelope.volume / 15 * 0.25;
                    }
                    
                    channel.gain.gain.value = volume;
                } else {
                    channel.gain.gain.value = 0;
                }
            } else {
                channel.gain.gain.value = 0;
            }
        }
        
        // Master volume
        this.masterGain.gain.value = Math.max(this.leftVolume, this.rightVolume) / 7 * 0.1;
    }
}

