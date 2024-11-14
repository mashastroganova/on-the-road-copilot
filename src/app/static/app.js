const toggleButton = document.getElementById('toggleButton');
const callButton = document.getElementById('callButton');
const statusMessage = document.getElementById('statusMessage');
const reportDiv = document.getElementById('report');

let isRecording = false;
let websocket = null;
let audioContext = null;
let mediaStream = null;
let mediaProcessor = null;
let audioQueueTime = 0;

async function startRecording() {
    isRecording = true;
    toggleButton.textContent = 'Stop Conversation';
    statusMessage.textContent = 'Recording...';

    // Initialize AudioContext if not already done
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
        audioQueueTime = audioContext.currentTime;
    }

    // Open WebSocket connection
    websocket = new WebSocket(`ws://${window.location.host}/realtime`);

    websocket.onopen = () => {
        console.log('WebSocket connection opened');
        // Send session update
        const sessionUpdate = {
            type: 'session.update',
            session: {
                turn_detection: {
                    type: 'server_vad'
                }
            }
        };
        websocket.send(JSON.stringify(sessionUpdate));
    };

    websocket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        console.log('Received message:', message);
        handleWebSocketMessage(message);
    };

    websocket.onclose = () => {
        console.log('WebSocket connection closed');
        if (isRecording) {
            stopRecording();
        }
    };

    websocket.onerror = (event) => {
        console.error('WebSocket error:', event);
    };

    // Start recording audio
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const source = audioContext.createMediaStreamSource(mediaStream);

    mediaProcessor = audioContext.createScriptProcessor(4096, 1, 1);
    source.connect(mediaProcessor);
    mediaProcessor.connect(audioContext.destination);

    mediaProcessor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        // Convert Float32Array to Int16Array
        const int16Data = float32ToInt16(inputData);
        // Convert to Base64
        const base64Audio = int16ToBase64(int16Data);
        // Send audio data to server
        const audioCommand = {
            type: 'input_audio_buffer.append',
            audio: base64Audio
        };
        websocket.send(JSON.stringify(audioCommand));
    };
}

function stopRecording() {
    isRecording = false;
    toggleButton.textContent = 'Start Conversation';
    statusMessage.textContent = 'Stopped';

    if (mediaProcessor) {
        mediaProcessor.disconnect();
        mediaProcessor.onaudioprocess = null;
    }

    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }

    if (websocket) {
        websocket.close();
        websocket = null;
    }

    // Do not close the audioContext here; we'll manage it separately
}

function onToggleListening() {
    if (!isRecording) {
        startRecording();
    } else {
        stopRecording();
    }
}

function onCallButton() {
    phonenumber = document.getElementById('phonenumber').value;

    const callDetails = {
        number: phonenumber
    };

    theUrl = window.location.href + "call";
    var xmlHttp = new XMLHttpRequest();
    xmlHttp.open( "POST", theUrl, false );
    xmlHttp.send( callDetails );
    
    reportDiv.textContent = xmlHttp.responseText;   
}

toggleButton.addEventListener('click', onToggleListening);
callButton.addEventListener('click', onCallButton);

function handleWebSocketMessage(message) {
    switch (message.type) {
        case 'response.audio.delta':
            // Play audio delta
            if (message.delta) {
                playAudio(message.delta);
            }
            break;
        case 'response.done':
            // Conversation response is complete
            console.log('Response done');
            break;
        case 'extension.middle_tier_tool_response':
            // Handle tool response
            if (message.tool_name === 'generate_report') {
                const report = JSON.parse(message.tool_result);
                displayReport(report);
            }
            break;
        case 'error':
            console.error('Error message from server:', message);
            break;
        default:
            console.log('Unhandled message type:', message.type);
    }
}

function playAudio(base64Audio) {
    const binary = atob(base64Audio);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    const int16Array = new Int16Array(bytes.buffer);

    // Convert Int16Array to Float32Array
    const float32Array = int16ToFloat32(int16Array);

    // Create an AudioBuffer and play it
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
        audioQueueTime = audioContext.currentTime;
    }

    const audioBuffer = audioContext.createBuffer(1, float32Array.length, 24000);
    audioBuffer.copyToChannel(float32Array, 0);

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);

    // Schedule the audio chunk to play at the correct time
    const currentTime = audioContext.currentTime;
    const startTime = Math.max(audioQueueTime, currentTime + 0.1); // Slight delay to prevent overlap
    source.start(startTime);

    // Update the audioQueueTime to the end of this buffer
    audioQueueTime = startTime + audioBuffer.duration;

    source.onended = () => {
        // Handle when audio chunk finishes playing if needed
    };
}

function displayReport(report) {
    reportDiv.textContent = JSON.stringify(report, null, 2);
}

function float32ToInt16(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
        let s = Math.max(-1, Math.min(1, float32Array[i]));
        int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16Array;
}

function int16ToBase64(int16Array) {
    const byteArray = new Uint8Array(int16Array.buffer);
    let binary = '';
    for (let i = 0; i < byteArray.byteLength; i++) {
        binary += String.fromCharCode(byteArray[i]);
    }
    return btoa(binary);
}

function int16ToFloat32(int16Array) {
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
        let int = int16Array[i];
        // Convert back to float
        let float = int < 0 ? int / 0x8000 : int / 0x7FFF;
        float32Array[i] = float;
    }
    return float32Array;
}
