import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  getIdToken,
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
 * Las recetas se guardan en Firestore.
 * Las imágenes se guardan en Cloudinary mediante Cloudflare Worker.
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

const CLOUDINARY_WORKER_URL =
  "https://flor-de-pasta-api.ailenalves15.workers.dev";
const CLOUDINARY_FOLDER = "flor-de-pasta";

let recetas = [];
let categoriaActual = "Todas";
let usuarioActual = null;
let esAdministrador = false;
let cancelarEscuchaRecetas = null;
let recetaEnEdicion = null;

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

document.getElementById("year").textContent = new Date().getFullYear();

/* =========================
   UTILIDADES
========================= */

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

  return valor.toLocaleString("es-AR", {
    maximumFractionDigits: 3
  });
}

function traducirError(error) {
  const codigo = error?.code || "";

  const mensajes = {
    "auth/invalid-credential":
      "El correo o la contraseña son incorrectos.",
    "auth/invalid-email":
      "El formato del correo electrónico no es válido.",
    "auth/user-disabled":
      "Este usuario está deshabilitado.",
    "auth/too-many-requests":
      "Hubo demasiados intentos. Esperá un momento y probá de nuevo.",
    "auth/network-request-failed":
      "No se pudo conectar. Revisá tu conexión a internet.",
    "permission-denied":
      "Firebase rechazó la operación por permisos. Revisá las reglas y que tu usuario esté habilitado.",
    "unavailable":
      "Firebase no está disponible en este momento. Probá de nuevo."
  };

  return mensajes[codigo] ||
    error?.message ||
    "Revisá la configuración de Firebase e intentá nuevamente.";
}

function mostrarError(error, contexto = "Ocurrió un error") {
  console.error(contexto, error);
  alert(`${contexto}.\n\n${traducirError(error)}`);
}

function mostrarEstadoCarga(mensaje) {
  grid.innerHTML = `
    <p class="detail-description">${escaparHTML(mensaje)}</p>
  `;
}

function normalizarUnidadRendimiento(valor) {
  const unidad = String(valor || "").trim().toLowerCase();

  if (["unidad", "unidades", "u"].includes(unidad)) return "Unidades";
  if (["docena", "docenas", "doc"].includes(unidad)) return "Docenas";
  if (["plancha", "planchas"].includes(unidad)) return "Planchas";
  if (["kg", "kilo", "kilos", "kilogramo", "kilogramos"].includes(unidad)) return "Kg";

  return "Unidades";
}

function normalizarReceta(datos, id) {
  return {
    id,
    nombre: String(datos.nombre || ""),
    categoria: String(datos.categoria || "Masas"),
    descripcion: String(datos.descripcion || ""),
    rendimiento: Number(datos.rendimiento) || 1,
    unidadRendimiento: normalizarUnidadRendimiento(datos.unidadRendimiento),
    pesoNeto: Number(datos.pesoNeto) || 0,
    tiempo: Number(datos.tiempo) || 0,
    simbolo: String(datos.simbolo || datos.nombre?.slice(0, 2) || "FP"),
    imagenUrl: String(datos.imagenUrl || ""),
    imagenPath: String(datos.imagenPath || ""),
    ingredientes: Array.isArray(datos.ingredientes)
      ? datos.ingredientes
      : [],
    pasos: Array.isArray(datos.pasos) ? datos.pasos : [],
    oficial: datos.oficial !== false
  };
}

/* =========================
   CLOUDINARY
========================= */

async function obtenerDatosFirmaCloudinary() {
  if (!usuarioActual) {
    throw new Error(
      "Iniciá sesión como administradora para subir imágenes."
    );
  }

  const token = await getIdToken(usuarioActual, true);

  const respuesta = await fetch(
    `${CLOUDINARY_WORKER_URL}/cloudinary/sign`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );

  const datos = await respuesta.json().catch(() => ({}));

  if (!respuesta.ok) {
    throw new Error(
      datos.error || "No se pudo autorizar la subida de la imagen."
    );
  }

  return datos;
}

async function subirImagenCloudinary(archivo) {
  const firma = await obtenerDatosFirmaCloudinary();

  if (!firma.cloudName || !firma.apiKey || !firma.signature || !firma.timestamp) {
    throw new Error(
      "Cloudflare no devolvió todos los datos necesarios para subir la imagen."
    );
  }

  const formulario = new FormData();

  formulario.append("file", archivo);
  formulario.append("api_key", firma.apiKey);
  formulario.append("timestamp", String(firma.timestamp));
  formulario.append("folder", firma.folder || CLOUDINARY_FOLDER);
  formulario.append("signature", firma.signature);

  const respuesta = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(firma.cloudName)}/image/upload`,
    {
      method: "POST",
      body: formulario
    }
  );

  const datos = await respuesta.json().catch(() => ({}));

  if (!respuesta.ok || !datos.secure_url || !datos.public_id) {
    throw new Error(
      datos.error?.message ||
      "Cloudinary no pudo subir la imagen."
    );
  }

  return {
    url: datos.secure_url,
    publicId: datos.public_id
  };
}

async function borrarImagenCloudinary(publicId) {
  // Las imágenes antiguas de Firebase Storage no tienen public_id de Cloudinary.
  if (!publicId || !publicId.startsWith(`${CLOUDINARY_FOLDER}/`)) {
    return;
  }

  if (!usuarioActual) {
    throw new Error("No hay una sesión administradora activa.");
  }

  const token = await getIdToken(usuarioActual, true);

  const respuesta = await fetch(
    `${CLOUDINARY_WORKER_URL}/cloudinary/delete`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        publicIds: [publicId]
      })
    }
  );

  const datos = await respuesta.json().catch(() => ({}));

  if (!respuesta.ok) {
    throw new Error(
      datos.error || "No se pudo borrar la imagen de Cloudinary."
    );
  }
}

/* =========================
   LISTADO DE RECETAS
========================= */

function renderizarRecetas() {
  const busqueda = searchInput.value
    .trim()
    .toLocaleLowerCase("es-AR");

  const filtradas = recetas.filter(receta => {
    const coincideCategoria =
      categoriaActual === "Todas" ||
      receta.categoria === categoriaActual;

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
      <div class="recipe-cover" style="position:relative;overflow:hidden">
        ${
          receta.imagenUrl
            ? `
              <img
                src="${escaparHTML(receta.imagenUrl)}"
                alt="${escaparHTML(receta.nombre)}"
                loading="lazy"
                style="width:100%;height:100%;min-height:180px;object-fit:cover;display:block"
              >
            `
            : `
              <div class="cover-placeholder">
                ${escaparHTML(receta.simbolo)}
              </div>
            `
        }

        <span class="recipe-tag">
          ${escaparHTML(receta.categoria)}
        </span>
      </div>

      <div class="recipe-body">
        <h3>${escaparHTML(receta.nombre)}</h3>
        <p>${escaparHTML(receta.descripcion)}</p>

        <div class="recipe-meta">
          <span>
            Rinde ${formatoNumero(receta.rendimiento)}
            ${escaparHTML(receta.unidadRendimiento)}
          </span>

          <button
            class="view-recipe"
            data-open-recipe="${escaparHTML(receta.id)}"
            type="button"
          >
            Ver receta →
          </button>
        </div>
      </div>
    </article>
  `).join("");
}

/* =========================
   DETALLE DE UNA RECETA
========================= */

function renderizarDetalle(receta) {
  const ingredientesHTML = receta.ingredientes.map(ingrediente => `
    <li>
      <span>${escaparHTML(ingrediente.nombre)}</span>
      <span>
        ${formatoNumero(ingrediente.cantidad)}
        ${escaparHTML(ingrediente.unidad)}
      </span>
    </li>
  `).join("");

  const pasosHTML = receta.pasos.map((paso, indice) => `
    <li>${indice + 1}. ${escaparHTML(paso)}</li>
  `).join("");

  recipeDetail.innerHTML = `
    <div class="dialog-content">

      <div class="dialog-top">
        <div>
          <span class="eyebrow">
            ${escaparHTML(receta.categoria.toUpperCase())}
          </span>
          <h2>${escaparHTML(receta.nombre)}</h2>
        </div>

        <button
          class="close-button"
          id="closeRecipe"
          type="button"
          aria-label="Cerrar"
        >×</button>
      </div>

      ${
        receta.imagenUrl
          ? `
            <img
              src="${escaparHTML(receta.imagenUrl)}"
              alt="${escaparHTML(receta.nombre)}"
              style="display:block;width:100%;max-height:360px;object-fit:cover;border-radius:12px;margin:14px 0 20px"
            >
          `
          : ""
      }

      <p class="detail-description">
        ${escaparHTML(receta.descripcion)}
      </p>

      <div class="detail-stats">
        <div class="stat">
          <small>Rendimiento original</small>
          <strong>
            ${formatoNumero(receta.rendimiento)}
            ${escaparHTML(receta.unidadRendimiento)}
          </strong>
        </div>

        <div class="stat">
  <small>Peso neto</small>
  <strong>
    ${receta.pesoNeto > 0
      ? `${formatoNumero(receta.pesoNeto)} kg`
      : "Sin especificar"}
  </strong>
</div>

        <div class="stat">
          <small>Tiempo estimado</small>
          <strong>${formatoNumero(receta.tiempo)} minutos</strong>
        </div>
      </div>

      <div class="scale-panel">
        <h3>Calculadora de producción</h3>

        <p class="detail-description">
          Ingresá la cantidad de producto que querés preparar y calcularemos las cantidades necesarias de cada ingrediente.
          (Esto no modifica la receta guardada).
        </p>

        <label for="desiredYield">
          Cantidad a preparar (${escaparHTML(receta.unidadRendimiento)})
        </label>

        <input
          id="desiredYield"
          placeholder="Ej: 400"
          type="number"
          min="0.001"
          step="any"
          value="${escaparHTML(receta.rendimiento)}"
          required
        >
      </div>

      <h3>Ingredientes necesarios</h3>
      <ul class="ingredient-list" id="ingredientList">
        ${ingredientesHTML}
      </ul>

      <h3>Procedimiento</h3>
      <ol class="ingredient-list">
        ${pasosHTML || "<li>Sin pasos cargados.</li>"}
      </ol>

      ${
        esAdministrador
          ? `
            <div
              class="admin-actions"
              style="display:flex;gap:10px;flex-wrap:wrap;margin-top:24px"
            >
              <button
                class="primary-button"
                id="editThisRecipe"
                type="button"
              >
                Editar receta
              </button>

              <button
                class="secondary-button"
                id="deleteThisRecipe"
                type="button"
              >
                Eliminar receta
              </button>
            </div>
          `
          : ""
      }

    </div>
  `;

  document.getElementById("closeRecipe").addEventListener("click", () => {
    recipeDialog.close();
  });

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
        <span>
          ${formatoNumero(Math.round(Number(ingrediente.cantidad) * factor))}
          ${escaparHTML(ingrediente.unidad)}
        </span>
      </li>
    `).join("");
  });

  if (esAdministrador) {
  document.getElementById("editThisRecipe").addEventListener("click", () => {
  recipeDialog.close();
  abrirFormularioReceta(receta);

  if (!adminDialog.open) {
    adminDialog.showModal();
  }
});

    document.getElementById("deleteThisRecipe").addEventListener("click", async () => {
      if (!confirm(
        `¿Querés eliminar la receta "${receta.nombre}"? Esta acción no se puede deshacer.`
      )) {
        return;
      }

      try {
        await deleteDoc(doc(db, "recetas", receta.id));

        if (receta.imagenPath) {
          try {
            await borrarImagenCloudinary(receta.imagenPath);
          } catch (errorImagen) {
            console.warn(
              "La receta se eliminó, pero no se pudo borrar su imagen de Cloudinary:",
              errorImagen
            );
          }
        }

        recipeDialog.close();
        alert("Receta eliminada correctamente.");
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

/* =========================
   CATEGORÍAS
========================= */

function actualizarCategoriasDisponibles() {
  const categoriasGuardadas = [
    ...new Set(recetas.map(receta => receta.categoria).filter(Boolean))
  ];

  const fijas = [
    "Masas",
    "Rellenos",
    "Salsas",
    "Productos terminados"
  ];

  const lista = [...new Set([...fijas, ...categoriasGuardadas])];

  categories.innerHTML = `
    <button
      class="category ${categoriaActual === "Todas" ? "active" : ""}"
      data-category="Todas"
      type="button"
      aria-pressed="${categoriaActual === "Todas"}"
    >Todas</button>

    ${lista.map(categoria => `
      <button
        class="category ${categoriaActual === categoria ? "active" : ""}"
        data-category="${escaparHTML(categoria)}"
        type="button"
        aria-pressed="${categoriaActual === categoria}"
      >${escaparHTML(categoria)}</button>
    `).join("")}
  `;
}

/* =========================
   CONEXIÓN CON FIRESTORE
========================= */

function escucharRecetas() {
  if (cancelarEscuchaRecetas) {
    cancelarEscuchaRecetas();
  }

  mostrarEstadoCarga("Cargando recetas...");

  cancelarEscuchaRecetas = onSnapshot(
    collection(db, "recetas"),
    snapshot => {
      recetas = snapshot.docs.map(documento =>
        normalizarReceta(documento.data(), documento.id)
      );

      recetas.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

      actualizarCategoriasDisponibles();
      renderizarRecetas();

      if (esAdministrador && document.getElementById("adminRecipeList")) {
        renderizarListaAdmin();
      }
    },
    error => {
      console.error("Error leyendo recetas:", error);

      mostrarEstadoCarga(
        "No se pudieron cargar las recetas. Revisá tu conexión y los permisos de Firebase."
      );

      mostrarError(error, "No se pudieron cargar las recetas");
    }
  );
}

/* =========================
   INICIO DE SESIÓN
========================= */

function mostrarLoginAdmin() {
  recetaEnEdicion = null;

  adminDialog.innerHTML = `
    <div class="dialog-top">
      <div>
        <span class="eyebrow">ACCESO RESTRINGIDO</span>
        <h2>Administración</h2>
      </div>

      <button
        class="close-button"
        id="closeAdmin"
        type="button"
        aria-label="Cerrar"
      >×</button>
    </div>

    <p>
      Iniciá sesión con tu correo y contraseña para administrar
      las recetas oficiales.
    </p>

    <form id="loginForm" class="admin-form">
      <label for="adminEmail">Correo electrónico</label>

      <input
        id="adminEmail"
        name="email"
        type="email"
        autocomplete="username"
        required
        style="width:100%;padding:12px;border:1px solid var(--line);border-radius:7px;margin:7px 0 15px"
      >

      <label for="adminPassword">Contraseña</label>

      <input
        id="adminPassword"
        name="password"
        type="password"
        autocomplete="current-password"
        required
        style="width:100%;padding:12px;border:1px solid var(--line);border-radius:7px;margin:7px 0 18px"
      >

      <p id="loginMessage" class="detail-description" role="status"></p>

      <button class="primary-button" type="submit">
        Iniciar sesión
      </button>
    </form>

    <p class="admin-notice">
      Las recetas solo pueden modificarse con una cuenta autorizada
      como administradora.
    </p>
  `;

  document.getElementById("closeAdmin").addEventListener("click", () => {
    adminDialog.close();
  });

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
    } catch (error) {
      mensaje.textContent = traducirError(error);
      boton.disabled = false;
      boton.textContent = "Iniciar sesión";
    }
  });
}

/* =========================
   PANEL DE ADMINISTRACIÓN
========================= */

function mostrarPanelAdmin() {
  adminDialog.innerHTML = `
    <div class="dialog-top">
      <div>
        <span class="eyebrow">PANEL PRIVADO</span>
        <h2>Administración</h2>
      </div>

      <button
        class="close-button"
        id="closeAdmin"
        type="button"
        aria-label="Cerrar"
      >×</button>
    </div>

    <p>
      Sesión iniciada:
      <strong>${escaparHTML(usuarioActual?.email || "")}</strong>
    </p>

    <div style="display:flex;gap:10px;flex-wrap:wrap;margin:18px 0">
      <button class="primary-button" id="newRecipeButton" type="button">
        ＋ Nueva receta
      </button>

      <button class="secondary-button" id="logoutButton" type="button">
        Cerrar sesión
      </button>
    </div>

    <p class="detail-description">
      Las recetas guardadas aquí se comparten con los usuarios autenticados
      del recetario.
    </p>

    <div id="adminRecipeList"></div>
  `;

  document.getElementById("closeAdmin").addEventListener("click", () => {
    adminDialog.close();
  });

  document.getElementById("newRecipeButton").addEventListener("click", () => {
    abrirFormularioReceta(null);
  });

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
    contenedor.innerHTML = `
      <p class="admin-notice">
        Todavía no hay recetas guardadas. Elegí “Nueva receta”
        para cargar la primera receta oficial.
      </p>
    `;
    return;
  }

  contenedor.innerHTML = `
    <h3>Recetas guardadas (${recetas.length})</h3>

    <ul class="ingredient-list">
      ${recetas.map(receta => `
        <li style="align-items:center">
          <span>
            <strong>${escaparHTML(receta.nombre)}</strong><br>
            <small>${escaparHTML(receta.categoria)}</small>
          </span>

          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button
              class="secondary-button"
              type="button"
              data-edit-id="${escaparHTML(receta.id)}"
            >Editar</button>

            <button
              class="secondary-button"
              type="button"
              data-delete-id="${escaparHTML(receta.id)}"
              style="border-color:#c62828;color:#c62828"
            >Eliminar</button>
          </div>
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

  contenedor.querySelectorAll("[data-delete-id]").forEach(boton => {
    boton.addEventListener("click", async () => {
      const receta = recetas.find(item => item.id === boton.dataset.deleteId);

      if (!receta) return;

      if (!confirm(
        `¿Querés eliminar la receta "${receta.nombre}"? Esta acción no se puede deshacer.`
      )) {
        return;
      }

      boton.disabled = true;
      boton.textContent = "Eliminando...";

      try {
        await deleteDoc(doc(db, "recetas", receta.id));

        if (receta.imagenPath) {
          try {
            await borrarImagenCloudinary(receta.imagenPath);
          } catch (errorImagen) {
            console.warn(
              "La receta se eliminó, pero no se pudo borrar su imagen de Cloudinary:",
              errorImagen
            );
          }
        }

        alert("Receta eliminada correctamente.");
      } catch (error) {
        mostrarError(error, "No se pudo eliminar la receta");
        boton.disabled = false;
        boton.textContent = "Eliminar";
      }
    });
  });
}

/* =========================
   FORMULARIO DE RECETAS
========================= */

function abrirFormularioReceta(receta) {
  recetaEnEdicion = receta ? receta.id : null;
  if (!adminDialog.open) {
  adminDialog.showModal();
}

  const ingredientes = receta
  ? receta.ingredientes
      .map(item => `${item.nombre}, ${item.cantidad}, ${item.unidad}`)
      .join("\n")
  : "";

  const pasos = receta ? receta.pasos.join("\n") : "";

  adminDialog.innerHTML = `
    <div class="dialog-top">
      <div>
        <span class="eyebrow">
          ${receta ? "EDITAR FICHA" : "NUEVA FICHA"}
        </span>

        <h2>${receta ? "Editar receta" : "Crear receta"}</h2>
      </div>

      <button
        class="close-button"
        id="closeAdmin"
        type="button"
        aria-label="Cerrar"
      >×</button>
    </div>

    <p>
      Cargá los ingredientes indicando el nombre, la cantidad y la unidad de medida de cada uno. Después, detallá el procedimiento paso a paso y, por último, guardá la receta.
    </p>

    <form id="recipeForm" class="admin-form">

      <label for="recipeName">Nombre de la receta *</label>
    <input
  id="recipeName"
  required
  maxlength="120"
  placeholder="Ej: Ricota, espinaca y nuez"
  value="${escaparHTML(receta?.nombre || "")}"
  style="width:100%;padding:11px;border:1px solid var(--line);border-radius:7px;margin:7px 0 14px"
>

      <label for="recipeCategory">Categoría *</label>
      <select
        id="recipeCategory"
        required
        style="width:100%;padding:11px;border:1px solid var(--line);border-radius:7px;margin:7px 0 14px"
      >
        ${[
          "Masas",
          "Rellenos",
          "Salsas",
          "Productos terminados",
          "Otras preparaciones"
        ].map(categoria => `
          <option
            value="${escaparHTML(categoria)}"
            ${(receta?.categoria || "Masas") === categoria ? "selected" : ""}
          >${escaparHTML(categoria)}</option>
        `).join("")}
      </select>

      <label for="recipeDescription">Descripción</label>
      <input
  id="recipeDescription"
  maxlength="250"
  placeholder="Ej: Relleno para raviolones"
  value="${escaparHTML(receta?.descripcion || "")}"
  style="width:100%;padding:11px;border:1px solid var(--line);border-radius:7px;margin:7px 0 14px"
>
>

      <label for="recipeImage">Foto de la receta (opcional)</label>

      <img
        id="recipeImagePreview"
        src="${escaparHTML(receta?.imagenUrl || "")}"
        alt="Vista previa de la foto"
        style="display:${receta?.imagenUrl ? "block" : "none"};width:100%;max-width:320px;max-height:220px;object-fit:cover;border-radius:10px;margin:8px 0"
      >

      <input
        id="recipeImage"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        style="width:100%;padding:10px;border:1px solid var(--line);border-radius:7px;margin:7px 0"
      >

      <small class="detail-description">
        Formatos: JPG, PNG, WEBP o GIF. Tamaño máximo: 5 MB.
        Si no seleccionás otra foto, se conserva la actual.
      </small>

      ${
        receta?.imagenUrl
          ? `
            <label style="display:flex;align-items:center;gap:8px;margin:8px 0 14px">
              <input id="removeRecipeImage" type="checkbox">
              Quitar la foto actual
            </label>
          `
          : ""
      }

      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start;gap:12px 16px">

  <div style="min-width:0">
    <label for="recipeYield">Rendimiento de la receta base *</label>
    <input
      id="recipeYield"
      placeholder="Ej: 120 raviolones"
      type="number"
      min="0.001"
      step="any"
      required
      value="${escaparHTML(receta?.rendimiento ?? "")}"
      style="box-sizing:border-box;width:100%;padding:11px;border:1px solid var(--line);border-radius:7px;margin:7px 0 14px"
    >
  </div>

  <div style="min-width:0">
    <label for="recipeYieldUnit">Unidad del rendimiento *</label>
    <select
      id="recipeYieldUnit"
      required
      style="box-sizing:border-box;width:100%;padding:11px;border:1px solid var(--line);border-radius:7px;margin:7px 0 14px;background:white"
    >
      <option value="Unidades" ${normalizarUnidadRendimiento(receta?.unidadRendimiento) === "Unidades" ? "selected" : ""}>Unidades</option>
      <option value="Docenas" ${normalizarUnidadRendimiento(receta?.unidadRendimiento) === "Docenas" ? "selected" : ""}>Docenas</option>
      <option value="Planchas" ${normalizarUnidadRendimiento(receta?.unidadRendimiento) === "Planchas" ? "selected" : ""}>Planchas</option>
      <option value="Kg" ${normalizarUnidadRendimiento(receta?.unidadRendimiento) === "Kg" ? "selected" : ""}>Kg</option>
    </select>
  </div>

    <div style="min-width:0;grid-column:1 / -1">
    <label for="recipeNetWeight">Peso neto de la receta (kg) *</label>
    <input
      id="recipeNetWeight"
      type="number"
      min="0.001"
      step="0.001"
      required
      placeholder="Ej.: 2,500 kg"
      value="${escaparHTML(receta?.pesoNeto ?? "")}"
      style="box-sizing:border-box;width:100%;padding:11px;border:1px solid var(--line);border-radius:7px;margin:7px 0 14px"
    >
    <small class="detail-description">
      Ingresá el peso neto total de la preparación en kilogramos.
    </small>
  </div>

  <div style="min-width:0;grid-column:1">
    <label for="recipeTime">Tiempo estimado (minutos)</label>
    <input
      id="recipeTime"
      placeholder="Ej: 15 minutos"
      type="number"
      min="0"
      step="1"
      value="${escaparHTML(receta?.tiempo ?? 0)}"
      style="box-sizing:border-box;width:100%;padding:11px;border:1px solid var(--line);border-radius:7px;margin:7px 0 14px"
    >
  </div>

  <div style="min-width:0;grid-column:1">
    <label for="recipeSymbol">Iniciales para la tarjeta</label>
    <input
      id="recipeSymbol"
      placeholder="Ej: REN"
      maxlength="8"
      value="${escaparHTML(receta?.simbolo || "")}"
      style="box-sizing:border-box;width:100%;padding:11px;border:1px solid var(--line);border-radius:7px;margin:7px 0 14px"
    >
  </div>

</div>

      </div>

      <label for="recipeIngredients">
  Ingredientes * (uno por línea: nombre, cantidad, unidad)
</label>

      <textarea
        id="recipeIngredients"
        required
        rows="6"
        placeholder="Harina, 500, g&#10;Huevo, 200, g"
        style="width:100%;padding:11px;border:1px solid var(--line);border-radius:7px;margin:7px 0 14px;resize:vertical"
      >${escaparHTML(ingredientes)}</textarea>

      <label for="recipeSteps">Procedimiento * (un paso por línea)</label>

      <textarea
        id="recipeSteps"
        required
        rows="6"
        placeholder="Mezclar los ingredientes.&#10;Amasar hasta integrar."
        style="width:100%;padding:11px;border:1px solid var(--line);border-radius:7px;margin:7px 0 14px;resize:vertical"
      >${escaparHTML(pasos)}</textarea>

      <p id="recipeFormMessage" class="detail-description" role="status"></p>

      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
        <button class="primary-button" type="submit">
          ${receta ? "Guardar cambios" : "Guardar receta"}
        </button>

        <button
          class="secondary-button"
          id="cancelRecipeForm"
          type="button"
        >Cancelar</button>
      </div>

    </form>
  `;

  document.getElementById("closeAdmin").addEventListener("click", () => {
    if (esAdministrador) {
      mostrarPanelAdmin();
    } else {
      adminDialog.close();
    }
  });

  document.getElementById("cancelRecipeForm").addEventListener("click", () => {
    mostrarPanelAdmin();
  });

  // Vista previa de la foto antes de guardarla.
  document.getElementById("recipeImage").addEventListener("change", event => {
    const archivo = event.target.files?.[0];
    const vista = document.getElementById("recipeImagePreview");

    if (!archivo) {
      vista.src = receta?.imagenUrl || "";
      vista.style.display = receta?.imagenUrl ? "block" : "none";
      return;
    }

    if (!archivo.type.startsWith("image/")) {
      event.target.value = "";
      alert("Seleccioná un archivo de imagen.");
      return;
    }

    if (archivo.size > 5 * 1024 * 1024) {
      event.target.value = "";
      alert("La imagen no puede superar los 5 MB.");
      return;
    }

    vista.src = URL.createObjectURL(archivo);
    vista.style.display = "block";
  });

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
          const partes = linea.split(/[,]/).map(parte => parte.trim());

          if (partes.length !== 3 || !partes[0] || !partes[2]) {
            throw new Error(
              `Revisá la línea ${indice + 1} de ingredientes. Usá: nombre , cantidad , unidad.`
            );
          }

          const cantidad = Number(partes[1].replace(",", "."));

          if (!Number.isFinite(cantidad) || cantidad < 0) {
            throw new Error(
              `La cantidad del ingrediente en la línea ${indice + 1} no es válida.`
            );
          }

          return {
            nombre: partes[0],
            cantidad,
            unidad: partes[2]
          };
        });

      if (ingredientes.length === 0) {
        throw new Error("Agregá al menos un ingrediente.");
      }

      const pasos = document.getElementById("recipeSteps").value
        .split("\n")
        .map(paso => paso.trim())
        .filter(Boolean);

      if (pasos.length === 0) {
        throw new Error("Agregá al menos un paso del procedimiento.");
      }

      const rendimiento = Number(
        document.getElementById("recipeYield").value
      );

      const pesoNeto = Number(
  document.getElementById("recipeNetWeight").value
);

if (!Number.isFinite(pesoNeto) || pesoNeto <= 0) {
  throw new Error("El peso neto debe ser mayor que cero.");
}

      if (!Number.isFinite(rendimiento) || rendimiento <= 0) {
        throw new Error("El rendimiento debe ser mayor que cero.");
      }

      let imagenUrl = receta?.imagenUrl || "";
      let imagenPath = receta?.imagenPath || "";
      let imagenAnteriorParaBorrar = "";

      const archivoImagen =
        document.getElementById("recipeImage").files?.[0];

      const quitarImagen =
        document.getElementById("removeRecipeImage")?.checked === true;

      // Subir foto nueva a Cloudinary, si se seleccionó una.
      if (archivoImagen) {
        if (!archivoImagen.type.startsWith("image/")) {
          throw new Error("Seleccioná un archivo de imagen válido.");
        }

        if (archivoImagen.size > 5 * 1024 * 1024) {
          throw new Error("La imagen no puede superar los 5 MB.");
        }

        const resultadoImagen = await subirImagenCloudinary(archivoImagen);

        imagenUrl = resultadoImagen.url;
        imagenPath = resultadoImagen.publicId;

        if (
          receta?.imagenPath &&
          receta.imagenPath !== resultadoImagen.publicId
        ) {
          imagenAnteriorParaBorrar = receta.imagenPath;
        }
      } else if (quitarImagen) {
        imagenAnteriorParaBorrar = imagenPath;
        imagenUrl = "";
        imagenPath = "";
      }

      const datos = {
  nombre: document.getElementById("recipeName").value.trim(),
  categoria: document.getElementById("recipeCategory").value,
  descripcion: document.getElementById("recipeDescription").value.trim(),
  rendimiento,
  pesoNeto,
  unidadRendimiento: document.getElementById("recipeYieldUnit").value.trim(),
        tiempo: Math.max(
          0,
          Number(document.getElementById("recipeTime").value) || 0
        ),
        simbolo:
          document.getElementById("recipeSymbol").value.trim() ||
          document.getElementById("recipeName").value.trim().slice(0, 2).toUpperCase(),
        imagenUrl,
        imagenPath,
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

      // Borrar la foto anterior solo después de guardar los cambios.
      if (imagenAnteriorParaBorrar) {
        try {
          await borrarImagenCloudinary(imagenAnteriorParaBorrar);
        } catch (errorImagen) {
          console.warn(
            "La receta se guardó, pero no se pudo borrar la imagen anterior:",
            errorImagen
          );
        }
      }

      mostrarPanelAdmin();

      alert(
        recetaEnEdicion
          ? "Receta actualizada correctamente."
          : "Receta guardada correctamente."
      );

    } catch (error) {
      mensaje.textContent = error.message || traducirError(error);

      if (error.code) {
        mensaje.textContent = traducirError(error);
      }

      boton.disabled = false;
      boton.textContent = recetaEnEdicion
        ? "Guardar cambios"
        : "Guardar receta";
    }
  });
}

/* =========================
   PERMISOS DE ADMINISTRADOR
========================= */

async function verificarAdministrador(usuario) {
  try {
    const referencia = doc(db, "admins", usuario.uid);
    const resultado = await getDoc(referencia);

    return resultado.exists() && resultado.data().activo === true;

  } catch (error) {
    console.error(
      "No se pudo verificar el permiso de administrador:",
      error
    );

    return false;
  }
}

adminButton.addEventListener("click", () => {
  if (esAdministrador && usuarioActual) {
    mostrarPanelAdmin();

  } else if (usuarioActual) {
    adminDialog.innerHTML = `
      <div class="dialog-top">
        <div>
          <span class="eyebrow">ACCESO RESTRINGIDO</span>
          <h2>Sin permisos</h2>
        </div>

        <button
          class="close-button"
          id="closeAdmin"
          type="button"
          aria-label="Cerrar"
        >×</button>
      </div>

      <p>
        La sesión está iniciada, pero esta cuenta no tiene permisos
        de administración.
      </p>

      <button class="secondary-button" id="logoutNoAdmin" type="button">
        Cerrar sesión
      </button>
    `;

    document.getElementById("closeAdmin").addEventListener("click", () => {
      adminDialog.close();
    });

    document.getElementById("logoutNoAdmin").addEventListener("click", async () => {
      await signOut(auth);
      adminDialog.close();
    });

  } else {
    mostrarLoginAdmin();
  }

  if (!adminDialog.open) {
    adminDialog.showModal();
  }
});

/* =========================
   BÚSQUEDA Y FILTROS
========================= */

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

  if (receta) {
    abrirDialogoReceta(receta);
  }
});

recipeDialog.addEventListener("click", event => {
  if (event.target === recipeDialog) {
    recipeDialog.close();
  }
});

adminDialog.addEventListener("click", event => {
  if (event.target === adminDialog) {
    adminDialog.close();
  }
});

/* =========================
   ESTADO DE AUTENTICACIÓN
========================= */

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

    recipeCount.textContent =
      "Iniciá sesión para consultar las recetas";

    return;
  }

  esAdministrador = await verificarAdministrador(usuario);

  escucharRecetas();

  if (adminDialog.open) {
  if (esAdministrador) {
    mostrarPanelAdmin();
  } else {
    // Si inicia sesión un usuario común, cerramos
    // la ventana de administración sin mostrar errores.
    adminDialog.close();
  }
}
});

/* =========================================
   MEDIDAS DISUASORIAS CONTRA LA COPIA
========================================= */

function estaDentroDeUnaReceta(elemento) {
  return Boolean(
    elemento.closest(
      ".recipe-card, .recipe-dialog, #recipeDetail, #recipeGrid"
    )
  );
}

// Desactivar el clic derecho sobre las recetas.
document.addEventListener("contextmenu", function (event) {
  if (estaDentroDeUnaReceta(event.target)) {
    event.preventDefault();
  }
});

// Bloquear algunos atajos de teclado sobre las recetas.
// No bloquea las herramientas externas ni las capturas del sistema.
document.addEventListener("keydown", function (event) {
  if (!estaDentroDeUnaReceta(event.target)) return;

  const elemento = event.target;
  const esCampoEditable =
    elemento.matches("input, textarea, select") ||
    elemento.isContentEditable;

  if (esCampoEditable) return;

  const tecla = event.key.toLowerCase();
  const modificador = event.ctrlKey || event.metaKey;

  if (
    modificador &&
    ["c", "s", "p", "u"].includes(tecla)
  ) {
    event.preventDefault();
  }
});

// Evitar arrastrar las imágenes de las recetas.
document.addEventListener("dragstart", function (event) {
  if (
    event.target instanceof HTMLImageElement &&
    estaDentroDeUnaReceta(event.target)
  ) {
    event.preventDefault();
  }
});

// Mostrar un aviso si se intenta imprimir la página.
window.addEventListener("beforeprint", function () {
  alert("La impresión del recetario está deshabilitada.");
});