
"use strict";

/* ==========================================
   SISTEMA DE CONTROL DE ASISTENCIA OFFLINE
   Registro manual y mediante código QR
   ========================================== */

// Guardar y recuperar información del navegador
function leerAlmacenamiento(clave) {
    try {
        const datos = JSON.parse(localStorage.getItem(clave) || "[]");
        return Array.isArray(datos) ? datos : [];
    } catch (error) {
        console.error("Error al leer " + clave, error);
        return [];
    }
}

let asistencias = leerAlmacenamiento("asistencias");
let estudiantes = leerAlmacenamiento("estudiantes");

let lectorQR = null;
let lectorActivo = false;
let procesandoQR = false;

// Grados disponibles según el nivel
const gradosPorNivel = {
    "Inicial": ["3 años", "4 años", "5 años"],
    "Primaria": [
        "1er grado", "2do grado", "3er grado",
        "4to grado", "5to grado", "6to grado"
    ],
    "Secundaria": [
        "1er grado", "2do grado", "3er grado",
        "4to grado", "5to grado"
    ]
};

const seccionesDisponibles = ["A", "B", "C", "D"];

// Obtener elementos HTML de manera segura
function obtenerElemento(id) {
    return document.getElementById(id);
}

function obtenerValor(id) {
    const elemento = obtenerElemento(id);
    return elemento ? elemento.value.trim() : "";
}

// Escapar texto antes de mostrarlo en la tabla
function escaparHTML(texto) {
    return String(texto ?? "").replace(/[&<>"']/g, caracter => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[caracter]);
}

// Guardar información localmente
function guardarDatos() {
    try {
        localStorage.setItem("asistencias", JSON.stringify(asistencias));
        localStorage.setItem("estudiantes", JSON.stringify(estudiantes));
        return true;
    } catch (error) {
        console.error("No se pudieron guardar los datos:", error);
        alert("No se pudieron guardar los datos. Revisa el espacio disponible del navegador.");
        return false;
    }
}

// Obtener fecha y hora local
function obtenerFechaHora() {
    const ahora = new Date();
    const anio = ahora.getFullYear();
    const mes = String(ahora.getMonth() + 1).padStart(2, "0");
    const dia = String(ahora.getDate()).padStart(2, "0");
    const hora = String(ahora.getHours()).padStart(2, "0");
    const minuto = String(ahora.getMinutes()).padStart(2, "0");
    const segundo = String(ahora.getSeconds()).padStart(2, "0");

    return {
        fechaISO: `${anio}-${mes}-${dia}`,
        fecha: `${dia}/${mes}/${anio}`,
        hora: `${hora}:${minuto}:${segundo}`
    };
}

// Actualizar opciones de grado según el nivel
function actualizarGrados() {
    const nivel = obtenerElemento("nivel");
    const grado = obtenerElemento("grado");
    const seccion = obtenerElemento("seccion");

    if (!nivel || !grado) return;

    const grados = gradosPorNivel[nivel.value] || [];

    grado.innerHTML = '<option value="">Seleccione grado</option>';

    grados.forEach(nombreGrado => {
        const opcion = document.createElement("option");
        opcion.value = nombreGrado;
        opcion.textContent = nombreGrado;
        grado.appendChild(opcion);
    });

    grado.disabled = grados.length === 0;

    if (seccion) {
        seccion.innerHTML = '<option value="">Seleccione sección</option>';
        seccion.disabled = true;
    }
}

// Actualizar opciones de sección
function actualizarSecciones() {
    const grado = obtenerElemento("grado");
    const seccion = obtenerElemento("seccion");

    if (!grado || !seccion) return;

    seccion.innerHTML = '<option value="">Seleccione sección</option>';

    if (!grado.value) {
        seccion.disabled = true;
        return;
    }

    seccionesDisponibles.forEach(nombreSeccion => {
        const opcion = document.createElement("option");
        opcion.value = nombreSeccion;
        opcion.textContent = nombreSeccion;
        seccion.appendChild(opcion);
    });

    seccion.disabled = false;
}

// Permitir únicamente números en el DNI
function configurarDNI() {
    const dni = obtenerElemento("dni");
    if (!dni) return;

    dni.maxLength = 8;
    dni.inputMode = "numeric";

    dni.addEventListener("input", function () {
        this.value = this.value.replace(/\D/g, "").slice(0, 8);
    });
}

// Validar los datos del estudiante
function obtenerDatosFormulario() {
    const datos = {
        dni: obtenerValor("dni"),
        nombres: obtenerValor("nombres"),
        apellidos: obtenerValor("apellidos"),
        nivel: obtenerValor("nivel"),
        grado: obtenerValor("grado"),
        seccion: obtenerValor("seccion")
    };

    if (!/^\d{8}$/.test(datos.dni)) {
        alert("El DNI debe contener exactamente 8 números.");
        obtenerElemento("dni")?.focus();
        return null;
    }

    if (!datos.nombres || !datos.apellidos) {
        alert("Ingrese los nombres y apellidos del estudiante.");
        return null;
    }

    if (!gradosPorNivel[datos.nivel]?.includes(datos.grado)) {
        alert("Seleccione un nivel y grado válidos.");
        return null;
    }

    if (!seccionesDisponibles.includes(datos.seccion)) {
        alert("Seleccione una sección válida.");
        return null;
    }

    return datos;
}

// Guardar o actualizar los datos de un estudiante por DNI
function guardarEstudiante(datos) {
    const indice = estudiantes.findIndex(
        estudiante => estudiante.dni === datos.dni
    );

    if (indice >= 0) {
        estudiantes[indice] = { ...estudiantes[indice], ...datos };
    } else {
        estudiantes.push({ ...datos });
    }

    return guardarDatos();
}

// Comprobar si el estudiante ya tiene asistencia hoy
function yaRegistroHoy(dni) {
    const hoy = obtenerFechaHora().fechaISO;

    return asistencias.some(registro =>
        registro.dni === dni &&
        (registro.fechaISO === hoy || (!registro.fechaISO && registro.fecha === obtenerFechaHora().fecha))
    );
}

// Registrar asistencia con los datos de un estudiante
function crearAsistencia(datos, origen) {
    if (yaRegistroHoy(datos.dni)) {
        mostrarMensajeQR(
            "Este estudiante ya tiene asistencia registrada hoy.",
            "error"
        );
        alert("El estudiante con DNI " + datos.dni + " ya registró asistencia hoy.");
        return false;
    }

    const momento = obtenerFechaHora();

    const nuevaAsistencia = {
        id: (typeof crypto !== "undefined" && crypto.randomUUID)
            ? crypto.randomUUID()
            : String(Date.now()) + "-" + Math.random().toString(36).slice(2, 8),
        dni: datos.dni,
        nombres: datos.nombres,
        apellidos: datos.apellidos,
        nivel: datos.nivel,
        grado: datos.grado,
        seccion: datos.seccion,
        fechaISO: momento.fechaISO,
        fecha: momento.fecha,
        hora: momento.hora,
        origen: origen,
        estado: "PENDIENTE"
    };

    asistencias.unshift(nuevaAsistencia);

    if (!guardarDatos()) {
        asistencias.shift();
        return false;
    }

    mostrarAsistencias();
    mostrarMensajeQR(
        "Asistencia registrada correctamente mediante " + origen + ".",
        "exito"
    );

    return true;
}

// Registrar asistencia manualmente desde el formulario
function registrarAsistencia() {
    const datos = obtenerDatosFormulario();
    if (!datos) return;

    if (!guardarEstudiante(datos)) return;

    const registrado = crearAsistencia(datos, "MANUAL");

    if (registrado) {
        limpiarFormulario();
    }
}

// Mostrar la lista de asistencias en la tabla
function mostrarAsistencias() {
    const tabla = obtenerElemento("tablaAsistencia");

    if (!tabla) {
        console.warn('No se encontró el elemento con id="tablaAsistencia".');
        return;
    }

    if (asistencias.length === 0) {
        tabla.innerHTML = `
            <tr>
                <td colspan="10">Todavía no hay asistencias registradas.</td>
            </tr>
        `;
        return;
    }

    tabla.innerHTML = asistencias.map(registro => {
        const claseEstado = registro.estado === "SINCRONIZADO"
            ? "sincronizado"
            : "pendiente";

        return `
            <tr>
                <td>${escaparHTML(registro.dni)}</td>
                <td>${escaparHTML(registro.nombres)}</td>
                <td>${escaparHTML(registro.apellidos)}</td>
                <td>${escaparHTML(registro.nivel)}</td>
                <td>${escaparHTML(registro.grado)}</td>
                <td>${escaparHTML(registro.seccion)}</td>
                <td>${escaparHTML(registro.fecha || "")}</td>
                <td>${escaparHTML(registro.hora || "")}</td>
                <td>${escaparHTML(registro.origen || "MANUAL")}</td>
                <td class="${claseEstado}">${escaparHTML(registro.estado || "PENDIENTE")}</td>
            </tr>
        `;
    }).join("");
}

// Limpiar los campos del formulario
function limpiarFormulario() {
    const ids = ["dni", "nombres", "apellidos", "nivel"];

    ids.forEach(id => {
        const elemento = obtenerElemento(id);
        if (elemento) elemento.value = "";
    });

    actualizarGrados();
    obtenerElemento("dni")?.focus();
}

// Mostrar el estado de conexión
function actualizarConexion() {
    const estado = obtenerElemento("estadoConexion");
    if (!estado) return;

    if (navigator.onLine) {
        estado.textContent = "🟢 Con conexión a internet";
    } else {
        estado.textContent = "🔴 Sin conexión: modo offline";
    }
}

// Mostrar mensajes en la sección QR
function mostrarMensajeQR(mensaje, tipo) {
    const elemento = obtenerElemento("mensajeQR");
    if (!elemento) {
        if (mensaje) console.log(mensaje);
        return;
    }

    elemento.textContent = mensaje;
    elemento.className = tipo || "";
}

// Buscar un estudiante guardado por DNI
function buscarEstudiantePorDNI(dni) {
    return estudiantes.find(estudiante => estudiante.dni === dni) || null;
}

// Procesar un código QR leído por la cámara
function procesarContenidoQR(contenido) {
    if (procesandoQR) return;
    procesandoQR = true;

    try {
        let datos = null;
        const texto = String(contenido || "").trim();

        // El QR puede contener los datos en formato JSON
        try {
            const objeto = JSON.parse(texto);

            if (objeto && typeof objeto === "object" && !Array.isArray(objeto)) {
                datos = {
                    dni: String(objeto.dni || "").trim(),
                    nombres: String(objeto.nombres || "").trim(),
                    apellidos: String(objeto.apellidos || "").trim(),
                    nivel: String(objeto.nivel || "").trim(),
                    grado: String(objeto.grado || "").trim(),
                    seccion: String(objeto.seccion || "").trim()
                };
            }
        } catch (error) {
            // Si no es JSON, se comprobará si contiene solo el DNI.
        }

        // Si el QR contiene solo el DNI, el estudiante debe estar guardado
        if (!datos && /^\d{8}$/.test(texto)) {
            datos = buscarEstudiantePorDNI(texto);
        }

        if (!datos) {
            mostrarMensajeQR(
                "QR no válido. Debe contener los datos del estudiante en JSON o un DNI de 8 dígitos previamente registrado.",
                "error"
            );
            return;
        }

        if (
            !/^\d{8}$/.test(datos.dni) ||
            !datos.nombres ||
            !datos.apellidos ||
            !gradosPorNivel[datos.nivel]?.includes(datos.grado) ||
            !seccionesDisponibles.includes(datos.seccion)
        ) {
            mostrarMensajeQR(
                "El QR no contiene todos los datos válidos del estudiante.",
                "error"
            );
            return;
        }

        if (guardarEstudiante(datos)) {
            crearAsistencia(datos, "QR");
        }
    } finally {
        // Evitar lecturas repetidas del mismo cuadro QR
        setTimeout(() => {
            procesandoQR = false;
        }, 1800);
    }
}

// Iniciar la cámara y el lector QR
async function iniciarLectorQR() {
    if (lectorActivo) {
        mostrarMensajeQR("El lector QR ya está activo.", "exito");
        return;
    }

    if (typeof Html5Qrcode === "undefined") {
        mostrarMensajeQR(
            "No se encontró la librería QR. Comprueba que html5-qrcode esté cargada.",
            "error"
        );
        return;
    }

    if (!obtenerElemento("lectorQR")) {
        mostrarMensajeQR(
            'Falta el contenedor HTML con id="lectorQR".',
            "error"
        );
        return;
    }

    try {
        lectorQR = new Html5Qrcode("lectorQR");

        await lectorQR.start(
            { facingMode: "environment" },
            {
                fps: 10,
                qrbox: { width: 250, height: 250 },
                aspectRatio: 1
            },
            contenidoLeido => {
                procesarContenidoQR(contenidoLeido);
            },
            () => {
                // Los errores de lectura de cada fotograma son normales.
            }
        );

        lectorActivo = true;
        mostrarMensajeQR(
            "Cámara activada. Coloca el código QR frente a la cámara.",
            "exito"
        );
    } catch (error) {
        console.error("Error al iniciar la cámara:", error);
        lectorQR = null;
        lectorActivo = false;

        mostrarMensajeQR(
            "No se pudo iniciar la cámara. Revisa los permisos y ejecuta la página desde localhost o HTTPS.",
            "error"
        );
    }
}

// Detener la cámara
async function detenerLectorQR() {
    if (!lectorQR || !lectorActivo) {
        mostrarMensajeQR("El lector QR está detenido.", "");
        return;
    }

    try {
        await lectorQR.stop();
        lectorQR.clear();
        mostrarMensajeQR("Cámara detenida correctamente.", "exito");
    } catch (error) {
        console.error("Error al detener la cámara:", error);
        mostrarMensajeQR("No se pudo detener la cámara correctamente.", "error");
    } finally {
        lectorQR = null;
        lectorActivo = false;
    }
}

// Informar sobre sincronización real
function sincronizar() {
    if (!navigator.onLine) {
        alert("No hay internet. Las asistencias permanecen guardadas en esta computadora.");
        return;
    }

    const pendientes = asistencias.filter(
        registro => registro.estado !== "SINCRONIZADO"
    ).length;

    if (pendientes === 0) {
        alert("No hay asistencias pendientes.");
    } else {
        alert(
            "Hay " + pendientes + " asistencias pendientes. Para sincronizarlas con otros dispositivos, primero se debe configurar un servidor o una API. Por ahora, los datos están guardados localmente."
        );
    }
}

// Eliminar asistencias con confirmación y clave de administrador
function limpiarRegistros() {
    const clave = prompt("Ingrese la clave de administrador para eliminar las asistencias:");

    if (clave === null) return;

    if (clave !== "ADMIN123") {
        alert("Clave incorrecta. No se eliminaron los registros.");
        return;
    }

    const confirmar = confirm(
        "¿Está seguro de eliminar todas las asistencias? Esta acción no se puede deshacer."
    );

    if (!confirmar) return;

    const asistenciasAnteriores = asistencias;
    asistencias = [];

    if (guardarDatos()) {
        mostrarAsistencias();
        alert("Se eliminaron las asistencias.");
    } else {
        asistencias = asistenciasAnteriores;
    }
}

// Preparar la aplicación al cargar la página
document.addEventListener("DOMContentLoaded", function () {
    configurarDNI();

    const nivel = obtenerElemento("nivel");
    const grado = obtenerElemento("grado");

    if (nivel) {
        nivel.addEventListener("change", actualizarGrados);
        actualizarGrados();
    }

    if (grado) {
        grado.addEventListener("change", actualizarSecciones);
    }

    actualizarConexion();
    mostrarAsistencias();

    // Evitar que el formulario recargue la página
    document.querySelectorAll("form").forEach(formulario => {
        formulario.addEventListener("submit", function (evento) {
            evento.preventDefault();
        });
    });
});

window.registrarAsistencia = registrarAsistencia;
window.actualizarGrados = actualizarGrados;
window.actualizarSecciones = actualizarSecciones;
window.mostrarAsistencias = mostrarAsistencias;
window.limpiarFormulario = limpiarFormulario;
window.actualizarConexion = actualizarConexion;
window.iniciarLectorQR = iniciarLectorQR;
window.detenerLectorQR = detenerLectorQR;
window.procesarContenidoQR = procesarContenidoQR;
window.sincronizar = sincronizar;
window.limpiarRegistros = limpiarRegistros;

window.addEventListener("online", actualizarConexion);
window.addEventListener("offline", actualizarConexion);
