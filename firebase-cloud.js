/* CruciAula · Firebase · Panel docente online (versión 0.4)
 * Configuración web pública, NO una clave de administrador.
 * La protección real depende de Firebase Authentication y las reglas de Firestore.
 */
'use strict';
const CruciAulaCloud = (() => {
  const TEACHER_UID = 'jK0fuo2dqzSrvsCzFhWMf3vPOPF2';
  const config = {
    apiKey: 'AIzaSyB2X9GbPTRIn5LdetmzMhUihYUPQJI5Hs8',
    authDomain: 'cruciaula.firebaseapp.com',
    projectId: 'cruciaula',
    storageBucket: 'cruciaula.firebasestorage.app',
    messagingSenderId: '319707417848',
    appId: '1:319707417848:web:fdbf62585e5d647f7e7f0d'
  };
  if (!window.firebase) return {ready:false, reason:'No se cargó Firebase. Comprobá la conexión a internet.'};
  try {
    const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(config);
    const auth=app.auth(), db=app.firestore();
    return {ready:true, auth, db, TEACHER_UID};
  } catch (err) {
    return {ready:false, reason:`No se pudo iniciar Firebase: ${err.message}`};
  }
})();
window.CruciAulaCloud=CruciAulaCloud;
