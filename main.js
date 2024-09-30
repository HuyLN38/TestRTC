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

const pc  = new RTCPeerConnection({
  iceServers: [
      {
        urls: "stun:stun.relay.metered.ca:80",
      },
      {
        urls: "turn:asia.relay.metered.ca:80",
        username: "82d7ed123310a073e284b789",
        credential: "IPVkAILEZ+W7NwgG",
      },
      {
        urls: "turn:asia.relay.metered.ca:80?transport=tcp",
        username: "82d7ed123310a073e284b789",
        credential: "IPVkAILEZ+W7NwgG",
      },
      {
        urls: "turn:asia.relay.metered.ca:443",
        username: "82d7ed123310a073e284b789",
        credential: "IPVkAILEZ+W7NwgG",
      },
      {
        urls: "turns:asia.relay.metered.ca:443?transport=tcp",
        username: "82d7ed123310a073e284b789",
        credential: "IPVkAILEZ+W7NwgG",
      },
  ],
});

let localStream = null;
let remoteStream = null;

// HTML elements
const webcamButton = document.getElementById('webcamButton');
const webcamVideo = document.getElementById('webcamVideo');
const callButton = document.getElementById('callButton');
const callInput = document.getElementById('callInput');
const answerButton = document.getElementById('answerButton');
const remoteVideo = document.getElementById('remoteVideo');
const hangupButton = document.getElementById('hangupButton');

let callDoc = null;
let callId = null;

// 1. Setup media sources
webcamButton.onclick = async () => {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  remoteStream = new MediaStream();

  // Push tracks from local stream to peer connection
  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  // Pull tracks from remote stream, add to video stream
  pc.ontrack = (event) => {
    event.streams[0].getTracks().forEach((track) => {
      remoteStream.addTrack(track);
    });
  };

  webcamVideo.srcObject = localStream;
  remoteVideo.srcObject = remoteStream;

  callButton.disabled = false;
  answerButton.disabled = false;
  webcamButton.disabled = true;
};

// 2. Create an offer
callButton.onclick = async () => {
  // Reference Firestore collections for signaling
  callDoc = firestore.collection('calls').doc();
  const offerCandidates = callDoc.collection('offerCandidates');
  const answerCandidates = callDoc.collection('answerCandidates');

  callId = callDoc.id;
  callInput.value = callId;

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

  hangupButton.disabled = false;
  answerButton.disabled = true;
};

// 3. Answer the call with the unique ID
answerButton.onclick = async () => {
  callId = callInput.value;
  if (!callId) {
    alert('Please enter a valid call ID');
    return;
  }

  callDoc = firestore.collection('calls').doc(callId);
  const callData = (await callDoc.get()).data();

  if (!callData) {
    alert('Call not found');
    return;
  }

  if (callData.answer) {
    alert('This call has already been answered');
    return;
  }

  const answerCandidates = callDoc.collection('answerCandidates');
  const offerCandidates = callDoc.collection('offerCandidates');

  pc.onicecandidate = (event) => {
    event.candidate && answerCandidates.add(event.candidate.toJSON());
  };

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
      if (change.type === 'added') {
        let data = change.doc.data();
        pc.addIceCandidate(new RTCIceCandidate(data));
      }
    });
  });

  hangupButton.disabled = false;
  callButton.disabled = true;
};

// 4. Hangup
hangupButton.onclick = async () => {
  // Stop all tracks of the local stream
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }

  // Close the peer connection
  if (pc) {
    pc.close();
  }

  // Reset video sources
  webcamVideo.srcObject = null;
  remoteVideo.srcObject = null;

  // Reset UI
  webcamButton.disabled = false;
  callButton.disabled = true;
  answerButton.disabled = true;
  hangupButton.disabled = true;

  // Remove the call document if it exists
  if (callDoc) {
    await callDoc.delete();
  }

  // Reset callDoc and callId
  callDoc = null;
  callId = null;
  callInput.value = '';
};

// Listen for hangup event from the other peer
pc.oniceconnectionstatechange = () => {
  if (pc.iceConnectionState === 'disconnected') {
    hangupButton.onclick();
  }
};