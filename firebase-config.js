
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDLeNqnn52AkstmkEtam70juPxgtGvH8X8",
  authDomain: "recetario-flor-de-pasta.firebaseapp.com",
  projectId: "recetario-flor-de-pasta",
  storageBucket: "recetario-flor-de-pasta.firebasestorage.app",
  messagingSenderId: "266005683556",
  appId: "1:266005683556:web:da98b91615601361f42e71"
};

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db };
