import { initializeApp } from "firebase/app";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyCzTe3vU0fDbOC5bkSFMqPprLxjzqWM0g4",
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "conversation-ai-experiments.firebaseapp.com",
    databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || "https://conversation-ai-experiments.firebaseio.com",
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "conversation-ai-experiments",
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "conversation-ai-experiments.appspot.com",
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "69384366574",
    appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:69384366574:web:2014e4b58513ec7ccbc6ff"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, "standalone");
const auth = getAuth(app);
const storage = getStorage(app);
const functions = getFunctions(app, "us-central1");

// Connect to local Firebase Emulators when running Svelte dev server
if (import.meta.env.DEV) {
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
    connectAuthEmulator(auth, "http://127.0.0.1:9099");
    connectStorageEmulator(storage, "127.0.0.1", 9199);
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}

export { app, db, auth, storage, functions };
