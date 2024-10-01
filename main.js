import './style.css';

import firebase from 'firebase/app';
import 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyBiMYp6mh6ITGKHKQX6ebyx4h0p6tj-j5E",
  authDomain: "parentlink-30210.firebaseapp.com",
  projectId: "parentlink-30210",
  storageBucket: "parentlink-30210.appspot.com",
  messagingSenderId: "1068208449918",
  appId: "1:1068208449918:web:1e8e2d718775473ebcab2f",
  measurementId: "G-K1Y01E2M2J"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const firestore = firebase.firestore();

const pc = new RTCPeerConnection({
  iceServers: [
    {
      urls: "STUN:freestun.net:3478",
    },
    {
      urls: "TURN:freestun.net:3478",
      username: "free",
      credential: "free",
    }
  ],
});
let localStream = null;
let remoteStream = null;
let isInCall = false;
let isCallCreator = false;

// HTML elements
const webcamButton = document.getElementById('webcamButton');
const webcamVideo = document.getElementById('webcamVideo');
const callButton = document.getElementById('callButton');
const callInput = document.getElementById('callInput');
const answerButton = document.getElementById('answerButton');
const remoteVideo = document.getElementById('remoteVideo');
const hangupButton = document.getElementById('hangupButton');

// Device selection dropdowns
const audioInputSelect = document.getElementById('audioSource');
const audioOutputSelect = document.getElementById('audioOutput');
const videoSelect = document.getElementById('videoSource');

// New element for notification
const notification = document.createElement('div');
notification.style.cssText = `
  position: fixed;
  top: 20px;
  right: 20px;
  background-color: red;
  color: white;
  padding: 10px;
  border-radius: 5px;
  display: none;
`;
document.body.appendChild(notification);

// Function to populate device options
async function populateDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  
  const audioInputDevices = devices.filter(device => device.kind === 'audioinput');
  const audioOutputDevices = devices.filter(device => device.kind === 'audiooutput');
  const videoDevices = devices.filter(device => device.kind === 'videoinput');

  audioInputSelect.innerHTML = audioInputDevices.map(device => `<option value="${device.deviceId}">${device.label}</option>`).join('');
  audioOutputSelect.innerHTML = audioOutputDevices.map(device => `<option value="${device.deviceId}">${device.label}</option>`).join('');
  videoSelect.innerHTML = videoDevices.map(device => `<option value="${device.deviceId}">${device.label}</option>`).join('');
}

// Populate devices on load
populateDevices();

// Function to get selected devices
function getSelectedDevices() {
  return {
    audio: { deviceId: audioInputSelect.value },
    video: { deviceId: videoSelect.value }
  };
}

// Update audio output device
audioOutputSelect.onchange = () => {
  if (typeof remoteVideo.sinkId !== 'undefined') {
    remoteVideo.setSinkId(audioOutputSelect.value);
  }
};

// Function to update button states
function updateButtonStates() {
  webcamButton.disabled = isInCall;
  callButton.disabled = !localStream || isInCall;
  answerButton.disabled = !localStream || isInCall || isCallCreator;
  hangupButton.disabled = !isInCall;
}

// 1. Setup media sources
webcamButton.onclick = async () => {
  const constraints = getSelectedDevices();
  localStream = await navigator.mediaDevices.getUserMedia(constraints);
  remoteStream = new MediaStream();

  // Push tracks from local stream to peer connection
  localStream.getTracks().forEach((track) => {
    const sender = pc.addTrack(track, localStream);
    if (track.kind === 'audio') {
      sender.setParameters({
        encodings: [{ dtx: true }]
      });
    }
  });

  // Pull tracks from remote stream, add to video stream
  pc.ontrack = (event) => {
    event.streams[0].getTracks().forEach((track) => {
      remoteStream.addTrack(track);
    });
  };

  // Set video source, but mute audio for local video
  webcamVideo.srcObject = localStream;
  webcamVideo.muted = true;
  remoteVideo.srcObject = remoteStream;

  updateButtonStates();

  // Re-populate devices to show labels
  await populateDevices();
};

// 2. Create an offer
callButton.onclick = async () => {
  // Reference Firestore collections for signaling
  const callDoc = firestore.collection('calls').doc();
  const offerCandidates = callDoc.collection('offerCandidates');
  const answerCandidates = callDoc.collection('answerCandidates');

  callInput.value = callDoc.id;

  // Get candidates for caller, save to db
  pc.onicecandidate = (event) => {
    event.candidate && offerCandidates.add(event.candidate.toJSON());
  };

  // Create offer
  const offerDescription = await pc.createOffer();
  await pc.setLocalDescription(offerDescription);

  const offer = {
    sdp: offerDescription.sdp,
    type: offerDescription.type,
  };

  await callDoc.set({ offer });

  // Listen for remote answer
  callDoc.onSnapshot((snapshot) => {
    const data = snapshot.data();
    if (!pc.currentRemoteDescription && data?.answer) {
      const answerDescription = new RTCSessionDescription(data.answer);
      pc.setRemoteDescription(answerDescription);
    }
    
    // Check if the other party has hung up
    if (data?.hangup) {
      handleRemoteHangup();
    }
  });

  // When answered, add candidate to peer connection
  answerCandidates.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        const candidate = new RTCIceCandidate(change.doc.data());
        pc.addIceCandidate(candidate);
      }
    });
  });

  isInCall = true;
  isCallCreator = true;
  updateButtonStates();
};

// 3. Answer the call with the unique ID
answerButton.onclick = async () => {
  const callId = callInput.value;
  const callDoc = firestore.collection('calls').doc(callId);
  const answerCandidates = callDoc.collection('answerCandidates');
  const offerCandidates = callDoc.collection('offerCandidates');

  pc.onicecandidate = (event) => {
    event.candidate && answerCandidates.add(event.candidate.toJSON());
  };

  const callData = (await callDoc.get()).data();

  const offerDescription = callData.offer;
  await pc.setRemoteDescription(new RTCSessionDescription(offerDescription));

  const answerDescription = await pc.createAnswer();
  await pc.setLocalDescription(answerDescription);

  const answer = {
    type: answerDescription.type,
    sdp: answerDescription.sdp,
  };

  await callDoc.update({ answer });

  offerCandidates.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      console.log(change);
      if (change.type === 'added') {
        let data = change.doc.data();
        pc.addIceCandidate(new RTCIceCandidate(data));
      }
    });
  });

  // Listen for hangup
  callDoc.onSnapshot((snapshot) => {
    const data = snapshot.data();
    if (data?.hangup) {
      handleRemoteHangup();
    }
  });

  isInCall = true;
  updateButtonStates();
};

// 4. Hangup call
hangupButton.onclick = async () => {
  if (!isInCall) return;

  const callId = callInput.value;
  const callDoc = firestore.collection('calls').doc(callId);
  
  // Update the document to indicate hangup
  await callDoc.update({ hangup: true });
  
  // Close the peer connection
  pc.close();
  
  // Stop all tracks on the local stream
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }
  
  // Clear the video elements
  webcamVideo.srcObject = null;
  remoteVideo.srcObject = null;
  
  // Reset state
  isInCall = false;
  isCallCreator = false;
  localStream = null;
  
  updateButtonStates();
};

// Function to handle remote hangup
function handleRemoteHangup() {
  // Display notification
  notification.textContent = "The other person has hung up";
  notification.style.display = "block";
  
  // Hide notification after 5 seconds
  setTimeout(() => {
    notification.style.display = "none";
  }, 5000);
  
  // Stop all tracks on the remote stream
  if (remoteStream) {
    remoteStream.getTracks().forEach(track => track.stop());
  }
  
  // Clear the remote video element
  remoteVideo.srcObject = null;
  
  // Reset state
  isInCall = false;
  isCallCreator = false;
  
  updateButtonStates();

  // Reset device selection
  audioInputSelect.selectedIndex = 0;
  audioOutputSelect.selectedIndex = 0;
  videoSelect.selectedIndex = 0;
}

// Initial button state update
updateButtonStates();