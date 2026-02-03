
let peer;
let myStream;
let myPeerId;
let currentMode;
let userName = "User";
let isMicOn = true;
let isVideoOn = false;
let isSharing = false;
let screenStream;
let hostId = null;
let expandedCard = null;

const peers = {};
const audioContexts = {};

function showToast(msg) {
    const el = document.getElementById('toast');
    el.innerText = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3000);
}

function prepareSession(mode) {
    currentMode = mode;
    if (mode === 'join') {
        const code = document.getElementById('input-code').value.trim();
        if (code.length < 5) return alert("Please enter a valid 5-character code.");
        hostId = code.toUpperCase();
    }
    document.getElementById('modal-name').classList.remove('hidden');
    document.getElementById('input-name').focus();
}

function cancelEntry() {
    document.getElementById('modal-name').classList.add('hidden');
}

async function confirmEntry() {
    const name = document.getElementById('input-name').value.trim();
    if (!name) return;
    userName = name;
    document.getElementById('modal-name').classList.add('hidden');
    try {
        await initLocalStream();
        document.getElementById('landing-screen').classList.add('hidden');
        document.getElementById('room-header').classList.remove('hidden');
        document.getElementById('room-header').classList.add('flex');
        document.getElementById('room-footer').classList.remove('hidden');
        document.getElementById('room-footer').classList.add('flex');
        document.getElementById('room-grid').classList.remove('hidden');
        if (currentMode === 'create') startHosting();
        else joinSession();
    } catch (e) {
        console.error(e);
        alert("Camera/Microphone access is required to join.");
    }
}

async function initLocalStream() {
    try {
        myStream = await navigator.mediaDevices.getUserMedia({
            video: { width: 1280, height: 720 },
            audio: { echoCancellation: true, noiseSuppression: true }
        });
        isVideoOn = true;
    } catch (e) {
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const dummyVideo = createDummyStream();
        myStream = new MediaStream([
            audioStream.getAudioTracks()[0],
            dummyVideo.getVideoTracks()[0]
        ]);
        isVideoOn = false;
    }
    addParticipant(myStream, 'me', userName, true);
    setupAudioAnalysis(myStream, 'me');
}

function createDummyStream() {
    const canvas = document.getElementById('hack-canvas');
    const ctx = canvas.getContext('2d');
    setInterval(() => {
        ctx.fillStyle = '#f3f4f6';
        ctx.fillRect(0, 0, 640, 480);
        ctx.fillStyle = '#6b7280';
        ctx.font = '30px Arial';
        ctx.fillText('Camera Off', 240, 240);
    }, 500);
    return canvas.captureStream(10);
}

function startHosting() {
    const id = Math.random().toString(36).substring(2, 7).toUpperCase();
    setupPeer(id);
    hostId = id;
}

function joinSession() {
    setupPeer(null);
}

function setupPeer(id) {
    peer = new Peer(id);
    peer.on('open', (myId) => {
        myPeerId = myId;
        document.getElementById('display-code').innerText = hostId || myId;
        if (hostId && hostId !== myId) {
            connectToPeer(hostId);
        }
    });
    peer.on('call', (call) => {
        call.answer(myStream);
        handleCall(call);
    });
    peer.on('connection', (conn) => {
        handleDataConnection(conn);
    });
    peer.on('error', (err) => {
        showToast("Error: " + err.type);
    });
}

function connectToPeer(targetId) {
    if (peers[targetId]) return;
    const conn = peer.connect(targetId, { metadata: { name: userName } });
    handleDataConnection(conn);
    const call = peer.call(targetId, myStream, { metadata: { name: userName } });
    handleCall(call);
}

function handleDataConnection(conn) {
    conn.on('open', () => {
        if (!peers[conn.peer]) peers[conn.peer] = {};
        peers[conn.peer].conn = conn;
        if (myPeerId === hostId && conn.peer !== hostId) {
            const existingPeers = Object.keys(peers).filter(id => id !== conn.peer);
            if (existingPeers.length > 0) {
                conn.send({ type: 'peer-list', users: existingPeers });
            }
        }
        conn.send({ type: 'status-sync', isSharing: isSharing, isMicOn: isMicOn, isVideoOn: isVideoOn });
    });
    conn.on('data', (data) => {
        switch (data.type) {
            case 'peer-list':
                data.users.forEach(userId => connectToPeer(userId));
                break;
            case 'status-sync':
                updateRemoteStatus(conn.peer, data);
                break;
        }
    });
    conn.on('close', () => {
        removeParticipant(conn.peer);
    });
}

function handleCall(call) {
    const peerId = call.peer;
    if (!peers[peerId]) peers[peerId] = {};
    peers[peerId].call = call;
    call.on('stream', (remoteStream) => {
        const name = call.metadata?.name || "Guest";
        addParticipant(remoteStream, peerId, name);
        setupAudioAnalysis(remoteStream, peerId);
    });
    call.peerConnection.addEventListener('track', (e) => {
        if (e.track.kind === 'video') {
            const videoEl = document.getElementById(`vid-${peerId}`);
            if (videoEl) {
                const newStream = new MediaStream([e.track]);
                const audioTracks = videoEl.srcObject?.getAudioTracks() || [];
                audioTracks.forEach(t => newStream.addTrack(t));
                videoEl.srcObject = newStream;
            }
        }
    });
    call.on('close', () => removeParticipant(peerId));
}

function broadcastStatus() {
    const status = { type: 'status-sync', isSharing: isSharing, isMicOn: isMicOn, isVideoOn: isVideoOn };
    Object.values(peers).forEach(p => {
        if (p.conn && p.conn.open) p.conn.send(status);
    });
}

function updateRemoteStatus(id, status) {
    const card = document.getElementById(`user-${id}`);
    const videoEl = document.getElementById(`vid-${id}`);
    const muteIcon = document.getElementById(`mute-icon-${id}`);
    const videoOffIcon = document.getElementById(`video-off-icon-${id}`);
    const avatar = document.getElementById(`avatar-${id}`);
    if (!card) return;

    if (status.isSharing || status.isVideoOn) {
        card.classList.add('video-active');
        videoEl.classList.remove('hidden');
        avatar.classList.add('hidden');
    } else {
        card.classList.remove('video-active');
        videoEl.classList.add('hidden');
        avatar.classList.remove('hidden');
    }

    if (!status.isMicOn) {
        muteIcon.classList.remove('hidden');
    } else {
        muteIcon.classList.add('hidden');
    }

    if (!status.isVideoOn && !status.isSharing) {
        if (videoOffIcon) videoOffIcon.classList.remove('hidden');
    } else {
        if (videoOffIcon) videoOffIcon.classList.add('hidden');
    }
}

function addParticipant(stream, id, name, isLocal = false) {
    if (document.getElementById(`user-${id}`)) return;
    const container = document.getElementById('grid-container');
    const card = document.createElement('div');
    card.id = `user-${id}`;
    card.className = 'user-card shadow-lg border-2 border-gray-200';
    const initials = name.substring(0, 2).toUpperCase();
    const showVideo = isLocal ? isVideoOn : false;

    card.innerHTML = `
        <button class="expand-btn" onclick="toggleExpand('${id}')">
            <i class="fas fa-expand"></i>
        </button>
        <video id="vid-${id}" autoplay playsinline class="${showVideo ? '' : 'hidden'}"></video>
        <div id="avatar-${id}" class="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-blue-500 to-purple-600 ${showVideo ? 'hidden' : ''}">
            <div class="text-white text-5xl font-bold">${initials}</div>
            <div id="ring-${id}" class="avatar-ring"></div>
        </div>
        <div class="absolute bottom-4 left-4 right-4 flex items-center justify-between">
            <div class="bg-black bg-opacity-70 text-white px-3 py-2 rounded-lg font-semibold text-sm">
                ${name} ${isLocal ? '(You)' : ''}
            </div>
            <div class="flex gap-2">
                <div id="mute-icon-${id}" class="hidden bg-red-500 text-white w-8 h-8 rounded-full flex items-center justify-center">
                    <i class="fas fa-microphone-slash text-xs"></i>
                </div>
                <div id="video-off-icon-${id}" class="hidden bg-gray-700 text-white w-8 h-8 rounded-full flex items-center justify-center">
                    <i class="fas fa-video-slash text-xs"></i>
                </div>
            </div>
        </div>
    `;
    container.appendChild(card);

    const count = Object.keys(peers).length + 1;
    document.getElementById('user-count').innerText = `${count} Online`;

    const videoEl = document.getElementById(`vid-${id}`);
    videoEl.srcObject = stream;
    if (isLocal) videoEl.muted = true;
}

function removeParticipant(id) {
    const el = document.getElementById(`user-${id}`);
    if (el) el.remove();
    if (peers[id]) delete peers[id];
    if (audioContexts[id]) {
        audioContexts[id].close();
        delete audioContexts[id];
    }
    const count = Object.keys(peers).length + 1;
    document.getElementById('user-count').innerText = `${count} Online`;
    showToast("User left the room");
}

function setupAudioAnalysis(stream, id) {
    if (!window.AudioContext && !window.webkitAudioContext) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = ctx.createAnalyser();
    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);
    analyser.fftSize = 256;
    audioContexts[id] = ctx;
    const buffer = new Uint8Array(analyser.frequencyBinCount);
    const avatar = document.getElementById(`avatar-${id}`);
    const ring = document.getElementById(`ring-${id}`);

    function frame() {
        if (!document.getElementById(`user-${id}`)) return;
        analyser.getByteFrequencyData(buffer);
        const sum = buffer.reduce((a, b) => a + b, 0);
        const avg = sum / buffer.length;
        if (avg > 10) {
            const scale = 1 + (avg / 255) * 0.3;
            if (avatar) avatar.style.transform = `scale(${scale})`;
            if (ring) {
                ring.style.opacity = avg / 150;
                ring.style.transform = `translate(-50%, -50%) scale(${1 + (avg / 80)})`;
            }
        } else {
            if (avatar) avatar.style.transform = `scale(1)`;
            if (ring) ring.style.opacity = 0;
        }
        requestAnimationFrame(frame);
    }
    frame();
}

async function toggleVideo() {
    const btn = document.getElementById('btn-video');
    const myCard = document.getElementById('user-me');
    const myVideo = document.getElementById('vid-me');
    const myAvatar = document.getElementById('avatar-me');

    if (!isVideoOn) {
        try {
            const videoStream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
            const videoTrack = videoStream.getVideoTracks()[0];
            const oldTrack = myStream.getVideoTracks()[0];
            myStream.removeTrack(oldTrack);
            myStream.addTrack(videoTrack);
            oldTrack.stop();

            myVideo.srcObject = myStream;
            myVideo.classList.remove('hidden');
            myAvatar.classList.add('hidden');

            Object.values(peers).forEach(p => {
                if (p.call) {
                    const sender = p.call.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
                    if (sender) sender.replaceTrack(videoTrack);
                }
            });

            btn.classList.replace('bg-red-50', 'bg-gray-100');
            btn.classList.replace('text-red-500', 'text-gray-600');
            btn.classList.replace('border-red-100', 'border-gray-200');
            btn.innerHTML = '<i class="fas fa-video mr-2"></i> Camera';
            isVideoOn = true;
        } catch (e) {
            showToast("Camera access denied");
        }
    } else {
        const dummyTrack = createDummyStream().getVideoTracks()[0];
        const oldTrack = myStream.getVideoTracks()[0];
        myStream.removeTrack(oldTrack);
        myStream.addTrack(dummyTrack);
        oldTrack.stop();

        myVideo.classList.add('hidden');
        myAvatar.classList.remove('hidden');

        Object.values(peers).forEach(p => {
            if (p.call) {
                const sender = p.call.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) sender.replaceTrack(dummyTrack);
            }
        });

        btn.classList.replace('bg-gray-100', 'bg-red-50');
        btn.classList.replace('text-gray-600', 'text-red-500');
        btn.classList.replace('border-gray-200', 'border-red-100');
        btn.innerHTML = '<i class="fas fa-video-slash mr-2"></i> Camera';
        isVideoOn = false;
    }
    broadcastStatus();
}

function toggleAudio() {
    isMicOn = !isMicOn;
    myStream.getAudioTracks()[0].enabled = isMicOn;
    const btn = document.getElementById('btn-audio');
    if (isMicOn) {
        btn.classList.replace('bg-red-50', 'bg-gray-100');
        btn.classList.replace('text-red-500', 'text-gray-600');
        btn.classList.replace('border-red-100', 'border-gray-200');
        btn.innerHTML = '<i class="fas fa-microphone mr-2"></i> Mic';
    } else {
        btn.classList.replace('bg-gray-100', 'bg-red-50');
        btn.classList.replace('text-gray-600', 'text-red-500');
        btn.classList.replace('border-gray-200', 'border-red-100');
        btn.innerHTML = '<i class="fas fa-microphone-slash mr-2"></i> Mic';
    }
    broadcastStatus();
}

async function toggleShare() {
    const btn = document.getElementById('btn-share');
    const myCard = document.getElementById('user-me');
    const myVideo = document.getElementById('vid-me');
    const myAvatar = document.getElementById('avatar-me');

    if (!isSharing) {
        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            const screenTrack = screenStream.getVideoTracks()[0];

            myVideo.srcObject = new MediaStream([screenTrack]);
            myCard.classList.add('video-active');
            myVideo.classList.remove('hidden');
            myAvatar.classList.add('hidden');

            Object.values(peers).forEach(p => {
                if (p.call) {
                    const sender = p.call.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
                    if (sender) sender.replaceTrack(screenTrack);
                }
            });

            btn.classList.add('text-blue-600', 'bg-blue-50', 'border-blue-200');
            btn.innerHTML = '<i class="fas fa-stop-circle mr-2"></i> Stop Share';
            isSharing = true;
            broadcastStatus();

            screenTrack.onended = () => toggleShare();
        } catch (e) {
            console.error("Share failed", e);
        }
    } else {
        const videoTrack = isVideoOn ? myStream.getVideoTracks()[0] : createDummyStream().getVideoTracks()[0];

        myCard.classList.remove('video-active');
        if (!isVideoOn) {
            myVideo.classList.add('hidden');
            myAvatar.classList.remove('hidden');
        } else {
            myVideo.srcObject = myStream;
        }

        if (screenStream) screenStream.getTracks().forEach(t => t.stop());

        Object.values(peers).forEach(p => {
            if (p.call) {
                const sender = p.call.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) sender.replaceTrack(videoTrack);
            }
        });

        btn.classList.remove('text-blue-600', 'bg-blue-50', 'border-blue-200');
        btn.innerHTML = '<i class="fas fa-desktop mr-2"></i> Share';
        isSharing = false;
        broadcastStatus();
    }
}

function toggleExpand(id) {
    const card = document.getElementById(`user-${id}`);
    const btn = card.querySelector('.expand-btn');
    
    if (expandedCard === id) {
        card.classList.remove('expanded');
        btn.innerHTML = '<i class="fas fa-expand"></i>';
        expandedCard = null;
    } else {
        if (expandedCard) {
            const prevCard = document.getElementById(`user-${expandedCard}`);
            prevCard.classList.remove('expanded');
            prevCard.querySelector('.expand-btn').innerHTML = '<i class="fas fa-expand"></i>';
        }
        card.classList.add('expanded');
        btn.innerHTML = '<i class="fas fa-compress"></i>';
        expandedCard = id;
    }
}

function copyCode() {
    const code = document.getElementById('display-code').innerText;
    navigator.clipboard.writeText(code);
    showToast("Room Code Copied!");
}

function leaveSession() {
    if (peer) peer.destroy();
    location.reload();
}

document.getElementById('input-name').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') confirmEntry();
});
