import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

/*
 * Flor de Pasta | Recetario
 * Las recetas se guardan en Firestore. No se cargan recetas ficticias
 * automáticamente para evitar confundir ejemplos con recetas oficiales.
 */

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

const grid = document.getElementById("recipeGrid");
const searchInput = document.getElementById("searchInput");
const categories = document.getElementById("categories");
const recipeCount = document.getElementById("recipeCount");
const emptyState = document.getElementById("emptyState");
const clearFilters = document.getElementById("clearFilters");
const recipeDialog = document.getElementById("recipeDialog");
const recipeDetail = document.getElementById("recipeDetail");
const adminDialog = document.getElementById("adminDialog");
const adminButton = document.getElementById("adminButton");

let recetas = [];
let categoriaActual = "Todas";
let usuarioActual = null;
let esAdministrador = false;
let cancelarEscuchaRecetas = null;
let recetaEnEdicion = null;
let avisoAdmin = "";

document.getElementById("year").textContent = new Date().getFullYear();

function escaparHTML(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, caracter => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[caracter]);
}

function formatoNumero(numero) {
  const valor = Number(numero);
  if (!Number.isFinite(valor)) return "0";
  return valor.toLocaleString("es-AR", { maximumFractionDigits: 3 });
}

function mostrarError(error, contexto = "Ocurrió un error") {
  console.error(contexto, error);
  const mensaje = traducirError(error);
  alert(`${contexto}.\n\n${mensaje}`);
}

function traducirError(error) {
  const codigo = error?.code || "";
  const mensajes = {
    "auth/invalid-credential": "El correo o la contraseña son incorrectos.",
    "auth/invalid-email": "El formato del correo electrónico no es válido.",
    "auth/user-disabled": "Este usuario está deshabilitado.",
    "auth/too-many-requests": "Hubo demasiados intentos. Esperá un momento y probá de nuevo.",
    "auth/network-request-failed": "No se pudo conectar. Revisá tu conexión a internet.",
    "permission-denied": "Firebase rechazó la operación por permisos. Revisá las reglas y que tu usuario esté habilitado.",
    "unavailable": "Firebase no está disponible en este momento. Probá de nuevo."
  };
  return mensajes[codigo] || error?.message || "Revisá la configuración de Firebase e intentá nuevamente.";
}

function mostrarEstadoCarga(mensaje) {
  grid.innerHTML = `<p class="detail-description">${escaparHTML(mensaje)}</p>`;
}

function normalizarReceta(datos, id) {
  return {
    id,
    nombre: String(datos.nombre || ""),
    categoria: String(datos.categoria || "Masas"),
    descripcion: String(datos.descripcion || ""),
    rendimiento: Number(datos.rendimiento) || 1,
    unidadRendimiento: String(datos.unidadRendimiento || "unidades"),
    tiempo: Number(datos.tiempo) || 0,
    simbolo: String(datos.simbolo || datos.nombre?.slice(0, 2) || "FP"),
    ingredientes: Array.isArray(datos.ingredientes) ? datos.ingredientes : [],
    pasos: Array.isArray(datos.pasos) ? datos.pasos : [],
    oficial: datos.oficial !== false
  };
}

function renderizarRecetas() {
  const busqueda = searchInput.value.trim().toLocaleLowerCase("es-AR");

  const filtradas = recetas.filter(receta => {
    const coincideCategoria =
      categoriaActual === "Todas" || receta.categoria === categoriaActual;

    const texto = [
      receta.nombre,
      receta.categoria,
      receta.descripcion,
      receta.unidadRendimiento,
      ...receta.ingredientes.map(ingrediente => ingrediente.nombre)
    ].join(" ").toLocaleLowerCase("es-AR");

    return coincideCategoria && texto.includes(busqueda);
  });

  recipeCount.textContent =
    `${filtradas.length} ${filtradas.length === 1 ? "receta" : "recetas"}`;

  emptyState.classList.toggle("hidden", filtradas.length > 0);

  if (filtradas.length === 0) {
    grid.innerHTML = "";
    return;
  }

  grid.innerHTML = filtradas.map(receta => `
    <article class="recipe-card">
      <div class="recipe-cover">
        <div class="cover-placeholder">${escaparHTML(receta.simbolo)}</div>
        <span class="recipe-tag">${escaparHTML(receta.categoria)}</span>
      </div>
      <div class="recipe-body">
        <h3>${escaparHTML(receta.nombre)}</h3>
        <p>${escaparHTML(receta.descripcion)}</p>
        <div class="recipe-meta">
          <span>Rinde ${formatoNumero(receta.rendimiento)} ${escaparHTML(receta.unidadRendimiento)}</span>
          <button class="view-recipe" data-open-recipe="${escaparHTML(receta.id)}" type="button">
            Ver receta →
          </button>
        </div>
      </div>
    </article>
  `).join("");
}

function renderizarDetalle(receta) {
  const ingredientesHTML = receta.ingredientes.map(ingrediente => `
    <li>
      <span>${escaparHTML(ingrediente.nombre)}</span>
      <span>${formatoNumero(ingrediente.cantidad)} ${escaparHTML(ingrediente.unidad)}</span>
    </li>
  `).join("");

  const pasosHTML = receta.pasos.map((paso, indice) => `
    <li>${indice + 1}. ${escaparHTML(paso)}</li>
  `).join("");

  recipeDetail.innerHTML = `
    <div class="dialog-content">
      <div class="dialog-top">
        <div>
          <span class="eyebrow">${escaparHTML(receta.categoria.toUpperCase())}</span>
          <h2>${escaparHTML(receta.nombre)}</h2>
        </div>
        <button class="close-button" id="closeRecipe" type="button" aria-label="Cerrar">×</button>
      </div>

      <p class="detail-description">${escaparHTML(receta.descripcion)}</p>

      <div class="detail-stats">
        <div class="stat">
          <small>Rendimiento original</small>
          <strong>${formatoNumero(receta.rendimiento)} ${escaparHTML(receta.unidadRendimiento)}</strong>
        </div>
        <div class="stat">
          <small>Tiempo estimado</small>
          <strong>${formatoNumero(receta.tiempo)} minutos</strong>
        </div>
      </div>

      <div class="scale-panel">
        <h3>Calculadora de producción</h3>
        <p class="detail-description">
          Cambiá el rendimiento deseado para recalcular las cantidades. Esto no modifica la receta guardada.
        </p>
        <label for="desiredYield">Cantidad deseada (${escaparHTML(receta.unidadRendimiento)})</label>
        <input id="desiredYield" type="number" min="0.001" step="any"
          value="${escaparHTML(receta.rendimiento)}" required>
      </div>

      <h3>Ingredientes necesarios</h3>
      <ul class="ingredient-list" id="ingredientList">${ingredientesHTML}</ul>

      <h3>Procedimiento</h3>
      <ol class="ingredient-list">${pasosHTML || "<li>Sin pasos cargados.</li>"}</ol>

      ${esAdministrador ? `
        <div class="admin-actions" style="display:flex;gap:10px;flex-wrap:wrap;margin-top:24px">
          <button class="primary-button" id="editThisRecipe" type="button">Editar receta</button>
          <button class="secondary-button" id="deleteThisRecipe" type="button">Eliminar receta</button>
        </div>` : ""}
    </div>
  `;

  document.getElementById("closeRecipe").addEventListener("click", () => recipeDialog.close());

  document.getElementById("desiredYield").addEventListener("input", event => {
    const cantidad = Number(event.target.value);
    const lista = document.getElementById("ingredientList");

    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      lista.innerHTML = "<li>Ingresá un rendimiento mayor que cero.</li>";
      return;
    }

    const factor = cantidad / receta.rendimiento;
    lista.innerHTML = receta.ingredientes.map(ingrediente => `
      <li>
        <span>${escaparHTML(ingrediente.nombre)}</span>
        <span>${formatoNumero(Number(ingrediente.cantidad) * factor)} ${escaparHTML(ingrediente.unidad)}</span>
      </li>
    `).join("");
  });

  if (esAdministrador) {
    document.getElementById("editThisRecipe").addEventListener("click", () => {
      recipeDialog.close();
      abrirFormularioReceta(receta);
    });

    document.getElementById("deleteThisRecipe").addEventListener("click", async () => {
      if (!confirm(`¿Querés eliminar la receta "${receta.nombre}"? Esta acción no se puede deshacer.`)) return;
      try {
        await deleteDoc(doc(db, "recetas", receta.id));
        recipeDialog.close();
        alert("Receta eliminada.");
      } catch (error) {
        mostrarError(error, "No se pudo eliminar la receta");
      }
    });
  }
}

function abrirDialogoReceta(receta) {
  renderizarDetalle(receta);
  recipeDialog.showModal();
}

function actualizarCategoriasDisponibles() {
  const categoriasGuardadas = [...new Set(recetas.map(receta => receta.categoria).filter(Boolean))];
  const fijas = ["Masas", "Rellenos", "Salsas", "Productos terminados"];
  const lista = [...new Set([...fijas, ...categoriasGuardadas])];

  categories.innerHTML = `
    <button class="category ${categoriaActual === "Todas" ? "active" : ""}" data-category="Todas" type="button" aria-pressed="${categoriaActual === "Todas"}">Todas</button>
    ${lista.map(categoria => `
      <button class="category ${categoriaActual === categoria ? "active" : ""}"
        data-category="${escaparHTML(categoria)}" type="button"
        aria-pressed="${categoriaActual === categoria}">${escaparHTML(categoria)}</button>
    `).join("")}
  `;
}

function escucharRecetas() {
  if (cancelarEscuchaRecetas) cancelarEscuchaRecetas();

  mostrarEstadoCarga("Cargando recetas...");
  cancelarEscuchaRecetas = onSnapshot(
    collection(db, "recetas"),
    snapshot => {
      recetas = snapshot.docs.map(documento => normalizarReceta(documento.data(), documento.id));
      recetas.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
      actualizarCategoriasDisponibles();
      renderizarRecetas();
    },
    error => {
      console.error("Error leyendo recetas:", error);
      mostrarEstadoCarga("No se pudieron cargar las recetas. Revisá tu conexión y los permisos de Firebase.");
      mostrarError(error, "No se pudieron cargar las recetas");
    }
  );
}

function mostrarLoginAdmin() {
  avisoAdmin = "";
  recetaEnEdicion = null;
  adminDialog.innerHTML = `
    <div class="dialog-top">
      <div>
        <span class="eyebrow">ACCESO RESTRINGIDO</span>
        <h2>Administración</h2>
      </div>
      <button class="close-button" id="closeAdmin" type="button" aria-label="Cerrar">×</button>
    </div>
    <p>Iniciá sesión con tu correo y contraseña para administrar las recetas oficiales.</p>
    <form id="loginForm" class="admin-form">
      <label for="adminEmail">Correo electrónico</label>
      <input id="adminEmail" name="email" type="email" autocomplete="username" required
        style="width:100%;padding:12px;border:1px solid var(--line);border-radius:7px;margin:7px 0 15px">
      <label for="adminPassword">Contraseña</label>
      <input id="adminPassword" name="password" type="password" autocomplete="current-password" required
        style="width:100%;padding:12px;border:1px solid var(--line);border-radius:7px;margin:7px 0 18px">
      <p id="loginMessage" class="detail-description" role="status"></p>
      <button class="primary-button" type="submit">Iniciar sesión</button>
    </form>
    <p class="admin-notice">Las recetas solo pueden modificarse con una cuenta autorizada como administradora.</p>
  `;

  document.getElementById("closeAdmin").addEventListener("click", () => adminDialog.close());
  document.getElementById("loginForm").addEventListener("submit", async event => {
    event.preventDefault();
    const boton = event.currentTarget.querySelector('button[type="submit"]');
    const mensaje = document.getElementById("loginMessage");
    boton.disabled = true;
    boton.textContent = "Ingresando...";
    mensaje.textContent = "";

    try {
      const email = document.getElementById("adminEmail").value.trim();
      const password = document.getElementById("adminPassword").value;
      await signInWithEmailAndPassword(auth, email, password);
      // onAuthStateChanged comprobará si el usuario está en admins/{uid}.
    } catch (error) {
      mensaje.textContent = traducirError(error);
      boton.disabled = false;
      boton.textContent = "Iniciar sesión";
    }
  });
}

function mostrarPanelAdmin() {
  adminDialog.innerHTML = `
    <div class="dialog-top">
      <div>
        <span class="eyebrow">PANEL PRIVADO</span>
        <h2>Administración</h2>
      </div>
      <button class="close-button" id="closeAdmin" type="button" aria-label="Cerrar">×</button>
    </div>
    <p>Sesión iniciada: <strong>${escaparHTML(usuarioActual?.email || "")}</strong></p>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin:18px 0">
      <button class="primary-button" id="newRecipeButton" type="button">＋ Nueva receta</button>
      <button class="secondary-button" id="logoutButton" type="button">Cerrar sesión</button>
    </div>
    <p class="detail-description">Las recetas guardadas aquí se comparten con los usuarios autenticados del recetario.</p>
    <div id="adminRecipeList"></div>
  `;

  document.getElementById("closeAdmin").addEventListener("click", () => adminDialog.close());
  document.getElementById("newRecipeButton").addEventListener("click", () => abrirFormularioReceta(null));
  document.getElementById("logoutButton").addEventListener("click", async () => {
    try {
      await signOut(auth);
      adminDialog.close();
    } catch (error) {
      mostrarError(error, "No se pudo cerrar la sesión");
    }
  });

  renderizarListaAdmin();
}

function renderizarListaAdmin() {
  const contenedor = document.getElementById("adminRecipeList");
  if (!contenedor) return;

  if (recetas.length === 0) {
    contenedor.innerHTML = `<p class="admin-notice">Todavía no hay recetas guardadas. Elegí “Nueva receta” para cargar la primera receta oficial.</p>`;
    return;
  }

  contenedor.innerHTML = `
    <h3>Recetas guardadas (${recetas.length})</h3>
    <ul class="ingredient-list">
      ${recetas.map(receta => `
        <li style="align-items:center">
          <span><strong>${escaparHTML(receta.nombre)}</strong><br><small>${escaparHTML(receta.categoria)}</small></span>
          <button class="secondary-button" type="button" data-edit-id="${escaparHTML(receta.id)}">Editar</button>
        </li>
      `).join("")}
    </ul>
  `;

  contenedor.querySelectorAll("[data-edit-id]").forEach(boton => {
    boton.addEventListener("click", () => {
      const receta = recetas.find(item => item.id === boton.dataset.editId);
      if (receta) abrirFormularioReceta(receta);
    });
  });
}

function abrirFormularioReceta(receta) {
  recetaEnEdicion = receta ? receta.id : null;

  const ingredientes = receta
    ? receta.ingredientes.map(item => `${item.nombre} | ${item.cantidad} | ${item.unidad}`).join("\n")
    : "";
  const pasos = receta ? receta.pasos.join("\n") : "";

  adminDialog.innerHTML = `
    <div class="dialog-top">
      <div>
        <span class="eyebrow">${receta ? "EDITAR FICHA" : "NUEVA FICHA"}</span>
        <h2>${receta ? "Editar receta" : "Crear receta"}</h2>
      </div>
      <button class="close-button" id="closeAdmin" type="button" aria-label="Cerrar">×</button>
    </div>
    <p>Completá los datos de la receta. No incluyas datos de ejemplo: cargá las cantidades y pasos aprobados por Flor de Pasta.</p>
    <form id="recipeForm" class="admin-form">
      <label for="recipeName">Nombre de la receta *</label>
      <input id="recipeName" required maxlength="120" value="${escaparHTML(receta?.nombre || "")}"
        style="width:100%;padding:11px;border:1px solid var(--line);border-radius:7px;margin:7px 0 14px">

      <label for="recipeCategory">Categoría *</label>
      <select id="recipeCategory" required style="width:100%;padding:11px;border:1px solid var(--line);border-radius:7px;margin:7px 0 14px">
        ${["Masas", "Rellenos", "Salsas", "Productos terminados", "Otras preparaciones"].map(c => `
          <option value="${c}" ${(receta?.categoria || "Masas") === c ? "selected" : ""}>${c}</option>
        `).join("")}
      </select>

      <label for="recipeDescription">Descripción</label>
      <input id="recipeDescription" maxlength="250" value="${escaparHTML(receta?.descripcion || "")}"
        style="width:100%;padding:11px;border:1px solid var(--line);border-radius:7px;margin:7px 0 14px">

      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">
        <div>
          <label for="recipeYield">Rendimiento original *</label>
          <input id="recipeYield" type="number" min="0.001" step="any" required value="${escaparHTML(receta?.rendimiento ?? "")}"
            style="width:100%;padding:11px;border:1px solid var(--line);border-radius:7px;margin:7px 0 14px">
        </div>
        <div>
          <label for="recipeYieldUnit">Unidad del rendimiento *</label>
          <input id="recipeYieldUnit" required maxlength="80" placeholder="ej. kg, planchas, unidades" value="${escaparHTML(receta?.unidadRendimiento || "")}"
            style="width:100%;padding:11px;border:1px solid var(--line);border-radius:7px;margin:7px 0 14px">
        </div>
        <div>
          <label for="recipeTime">Tiempo estimado (minutos)</label>
          <input id="recipeTime" type="number" min="0" step="1" value="${escaparHTML(receta?.tiempo ?? 0)}"
            style="width:100%;padding:11px;border:1px solid var(--line);border-radius:7px;margin:7px 0 14px">
        </div>
        <div>
          <label for="recipeSymbol">Iniciales para la tarjeta</label>
          <input id="recipeSymbol" maxlength="8" value="${escaparHTML(receta?.simbolo || "")}"
            style="width:100%;padding:11px;border:1px solid var(--line);border-radius:7px;margin:7px 0 14px">
        </div>
      </div>

      <label for="recipeIngredients">Ingredientes * (uno por línea: nombre | cantidad | unidad)</label>
      <textarea id="recipeIngredients" required rows="6" placeholder="Harina | 500 | g&#10;Huevo | 200 | g"
        style="width:100%;padding:11px;border:1px solid var(--line);border-radius:7px;margin:7px 0 14px;resize:vertical">${escaparHTML(ingredientes)}</textarea>

      <label for="recipeSteps">Procedimiento * (un paso por línea)</label>
      <textarea id="recipeSteps" required rows="6" placeholder="Mezclar los ingredientes.&#10;Amasar hasta integrar."
        style="width:100%;padding:11px;border:1px solid var(--line);border-radius:7px;margin:7px 0 14px;resize:vertical">${escaparHTML(pasos)}</textarea>

      <p id="recipeFormMessage" class="detail-description" role="status"></p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
        <button class="primary-button" type="submit">${receta ? "Guardar cambios" : "Guardar receta"}</button>
        <button class="secondary-button" id="cancelRecipeForm" type="button">Cancelar</button>
      </div>
    </form>
  `;

  document.getElementById("closeAdmin").addEventListener("click", () => {
    if (esAdministrador) mostrarPanelAdmin();
    else adminDialog.close();
  });
  document.getElementById("cancelRecipeForm").addEventListener("click", () => mostrarPanelAdmin());

  document.getElementById("recipeForm").addEventListener("submit", async event => {
    event.preventDefault();
    const boton = event.currentTarget.querySelector('button[type="submit"]');
    const mensaje = document.getElementById("recipeFormMessage");
    boton.disabled = true;
    boton.textContent = "Guardando...";
    mensaje.textContent = "";

    try {
      const ingredientes = document.getElementById("recipeIngredients").value
        .split("\n")
        .map(linea => linea.trim())
        .filter(Boolean)
        .map((linea, indice) => {
          const partes = linea.split("|").map(parte => parte.trim());
          if (partes.length !== 3 || !partes[0] || !partes[2]) {
            throw new Error(`Revisá la línea ${indice + 1} de ingredientes. Usá: nombre | cantidad | unidad.`);
          }
          const cantidad = Number(partes[1].replace(",", "."));
          if (!Number.isFinite(cantidad) || cantidad < 0) {
            throw new Error(`La cantidad del ingrediente en la línea ${indice + 1} no es válida.`);
          }
          return { nombre: partes[0], cantidad, unidad: partes[2] };
        });

      if (ingredientes.length === 0) throw new Error("Agregá al menos un ingrediente.");

      const pasos = document.getElementById("recipeSteps").value
        .split("\n").map(paso => paso.trim()).filter(Boolean);
      if (pasos.length === 0) throw new Error("Agregá al menos un paso del procedimiento.");

      const rendimiento = Number(document.getElementById("recipeYield").value);
      if (!Number.isFinite(rendimiento) || rendimiento <= 0) throw new Error("El rendimiento debe ser mayor que cero.");

      const datos = {
        nombre: document.getElementById("recipeName").value.trim(),
        categoria: document.getElementById("recipeCategory").value,
        descripcion: document.getElementById("recipeDescription").value.trim(),
        rendimiento,
        unidadRendimiento: document.getElementById("recipeYieldUnit").value.trim(),
        tiempo: Math.max(0, Number(document.getElementById("recipeTime").value) || 0),
        simbolo: document.getElementById("recipeSymbol").value.trim() ||
          document.getElementById("recipeName").value.trim().slice(0, 2).toUpperCase(),
        ingredientes,
        pasos,
        oficial: true,
        actualizadoEn: serverTimestamp(),
        actualizadoPor: usuarioActual.uid
      };

      if (recetaEnEdicion) {
        await updateDoc(doc(db, "recetas", recetaEnEdicion), datos);
      } else {
        datos.creadoEn = serverTimestamp();
        datos.creadoPor = usuarioActual.uid;
        await addDoc(collection(db, "recetas"), datos);
      }

      mostrarPanelAdmin();
      alert(recetaEnEdicion ? "Receta actualizada correctamente." : "Receta guardada correctamente.");
    } catch (error) {
      mensaje.textContent = error.message || traducirError(error);
      if (error.code) mensaje.textContent = traducirError(error);
      boton.disabled = false;
      boton.textContent = recetaEnEdicion ? "Guardar cambios" : "Guardar receta";
    }
  });
}

async function verificarAdministrador(usuario) {
  try {
    const referencia = doc(db, "admins", usuario.uid);
    const resultado = await getDoc(referencia);
    return resultado.exists() && resultado.data().activo === true;
  } catch (error) {
    console.error("No se pudo verificar el permiso de administrador:", error);
    return false;
  }
}

adminButton.addEventListener("click", () => {
  if (esAdministrador && usuarioActual) {
    mostrarPanelAdmin();
  } else if (usuarioActual) {
    adminDialog.innerHTML = `
      <div class="dialog-top">
        <div><span class="eyebrow">ACCESO RESTRINGIDO</span><h2>Sin permisos</h2></div>
        <button class="close-button" id="closeAdmin" type="button" aria-label="Cerrar">×</button>
      </div>
      <p>La sesión está iniciada, pero esta cuenta no tiene permisos de administración.</p>
      <button class="secondary-button" id="logoutNoAdmin" type="button">Cerrar sesión</button>
    `;
    document.getElementById("closeAdmin").addEventListener("click", () => adminDialog.close());
    document.getElementById("logoutNoAdmin").addEventListener("click", async () => {
      await signOut(auth);
      adminDialog.close();
    });
  } else {
    mostrarLoginAdmin();
  }
  if (!adminDialog.open) adminDialog.showModal();
});

categories.addEventListener("click", event => {
  const boton = event.target.closest("[data-category]");
  if (!boton) return;

  categoriaActual = boton.dataset.category;
  categories.querySelectorAll("[data-category]").forEach(item => {
    const activo = item === boton;
    item.classList.toggle("active", activo);
    item.setAttribute("aria-pressed", String(activo));
  });
  renderizarRecetas();
});

searchInput.addEventListener("input", renderizarRecetas);

clearFilters.addEventListener("click", () => {
  categoriaActual = "Todas";
  searchInput.value = "";
  actualizarCategoriasDisponibles();
  renderizarRecetas();
});

grid.addEventListener("click", event => {
  const boton = event.target.closest("[data-open-recipe]");
  if (!boton) return;
  const receta = recetas.find(item => item.id === boton.dataset.openRecipe);
  if (receta) abrirDialogoReceta(receta);
});

recipeDialog.addEventListener("click", event => {
  if (event.target === recipeDialog) recipeDialog.close();
});
adminDialog.addEventListener("click", event => {
  if (event.target === adminDialog) adminDialog.close();
});

onAuthStateChanged(auth, async usuario => {
  usuarioActual = usuario;
  esAdministrador = false;

  if (!usuario) {
    if (cancelarEscuchaRecetas) {
      cancelarEscuchaRecetas();
      cancelarEscuchaRecetas = null;
    }
    recetas = [];
    renderizarRecetas();
    recipeCount.textContent = "Iniciá sesión para consultar las recetas";
    return;
  }

  esAdministrador = await verificarAdministrador(usuario);
  escucharRecetas();

  // Si el diálogo de acceso está abierto, mostrar el resultado del inicio de sesión.
  if (adminDialog.open) {
    if (esAdministrador) {
      mostrarPanelAdmin();
    } else {
      adminDialog.innerHTML = `
        <div class="dialog-top">
          <div><span class="eyebrow">ACCESO RESTRINGIDO</span><h2>Sin permisos</h2></div>
          <button class="close-button" id="closeAdmin" type="button" aria-label="Cerrar">×</button>
        </div>
        <p>Iniciaste sesión, pero este usuario no figura como administrador activo.</p>
        <p class="admin-notice">Verificá que exista el documento admins/${escaparHTML(usuario.uid)} y que el campo activo sea Boolean true.</p>
        <button class="secondary-button" id="logoutNoAdmin" type="button">Cerrar sesión</button>
      `;
      document.getElementById("closeAdmin").addEventListener("click", () => adminDialog.close());
      document.getElementById("logoutNoAdmin").addEventListener("click", async () => {
        await signOut(auth);
        adminDialog.close();
      });
    }
  }
});