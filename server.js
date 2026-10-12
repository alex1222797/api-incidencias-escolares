// Importar librerías.
const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
require("dotenv").config();

// Crear la aplicación de Express.
const app = express();

// Permitir solicitudes desde Flutter.
app.use(cors());

// Permitir que Express reciba información JSON.
app.use(express.json());

// Carpeta de imágenes (se crea sola si no existe, importante en Render)
const carpetaUploads = path.join(__dirname, "uploads");
if (!fs.existsSync(carpetaUploads)) {
  fs.mkdirSync(carpetaUploads, { recursive: true });
}

// Servir las imágenes públicamente: /uploads/archivo.jpg
app.use("/uploads", express.static(carpetaUploads));

/*
|--------------------------------------------------------------------------
| CONEXIÓN CON MYSQL EN AIVEN
|--------------------------------------------------------------------------
*/

const conexion = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,

  // La propiedad correcta es database, no name.
  database: process.env.DB_NAME,

  // Aiven utiliza una conexión segura SSL.
  ssl: {
    rejectUnauthorized: false,
  },

  // Configuración del grupo de conexiones.
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

/*
|--------------------------------------------------------------------------
| COMPROBAR CONEXIÓN CON AIVEN
|--------------------------------------------------------------------------
*/

conexion.getConnection((error, connection) => {
  if (error) {
    console.error("Error al conectar con Aiven:");
    console.error(error.message);
    return;
  }

  console.log("Conexión exitosa con MySQL en Aiven");

  // Liberar la conexión para que vuelva al pool.
  connection.release();
});

/*
|--------------------------------------------------------------------------
| CONFIGURACIÓN DE MULTER (SUBIDA DE IMÁGENES)
|--------------------------------------------------------------------------
*/

const EXTENSIONES_PERMITIDAS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".heic",
  ".heif",
];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, carpetaUploads),
  filename: (req, file, cb) => {
    let extension = path.extname(file.originalname).toLowerCase();

    // Algunos celulares envían la foto sin extensión: usamos .jpg.
    if (!EXTENSIONES_PERMITIDAS.includes(extension)) {
      extension = ".jpg";
    }

    cb(null, Date.now() + extension);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();

    const esImagenPorTipo = file.mimetype.startsWith("image/");

    // Algunos celulares envían la foto como application/octet-stream.
    const esGenerico =
      file.mimetype === "application/octet-stream" &&
      (extension === "" || EXTENSIONES_PERMITIDAS.includes(extension));

    if (esImagenPorTipo || esGenerico) {
      cb(null, true);
    } else {
      cb(new Error("Solo se permiten imágenes"));
    }
  },
});

/*
|--------------------------------------------------------------------------
| RUTA PRINCIPAL
|--------------------------------------------------------------------------
| Sirve para comprobar que la API está funcionando.
|--------------------------------------------------------------------------
*/

app.get("/", (req, res) => {
  res.status(200).json({
    status: "ok",
    mensaje: "API de incidencias funcionando correctamente",
  });
});

/*
|--------------------------------------------------------------------------
| OBTENER CATEGORÍAS
|--------------------------------------------------------------------------
| Método: GET
| Ruta: /categorias
|--------------------------------------------------------------------------
*/

app.get("/categorias", (req, res) => {
  const sql = `
    SELECT id, nombre
    FROM categorias
    ORDER BY nombre ASC
  `;

  conexion.query(sql, (error, resultados) => {
    if (error) {
      console.error("Error al obtener categorías:", error.message);

      return res.status(500).json({
        status: "error",
        mensaje: "No se pudieron obtener las categorías",
      });
    }

    res.status(200).json({
      status: "ok",
      categorias: resultados,
    });
  });
});

/*
|--------------------------------------------------------------------------
| OBTENER INCIDENCIAS
|--------------------------------------------------------------------------
| Método: GET
| Ruta: /incidencias
|--------------------------------------------------------------------------
*/

app.get("/incidencias", (req, res) => {
  const sql = `
    SELECT i.id, i.descripcion, i.estado, i.fecha, i.imagen,
           c.nombre AS categoria
    FROM incidencias i
    JOIN categorias c ON i.categoria_id = c.id
    ORDER BY i.fecha DESC
  `;

  conexion.query(sql, (error, resultados) => {
    if (error) {
      console.error("Error al obtener incidencias:", error.message);

      return res.status(500).json({
        status: "error",
        mensaje: "No se pudieron obtener las incidencias",
      });
    }

    res.status(200).json({
      status: "ok",
      incidencias: resultados,
    });
  });
});

/*
|--------------------------------------------------------------------------
| ESTADÍSTICAS POR CATEGORÍA
|--------------------------------------------------------------------------
| Método: GET
| Ruta: /estadisticas/categorias
|--------------------------------------------------------------------------
*/

app.get("/estadisticas/categorias", (req, res) => {
  const sql = `
    SELECT c.nombre AS categoria, COUNT(i.id) AS total
    FROM categorias c
    LEFT JOIN incidencias i ON c.id = i.categoria_id
    GROUP BY c.id, c.nombre
    ORDER BY c.nombre ASC
  `;

  conexion.query(sql, (error, resultados) => {
    if (error) {
      console.error("Error en estadísticas por categoría:", error.message);

      return res.status(500).json({
        status: "error",
        mensaje: "No se pudieron obtener las estadísticas por categoría",
      });
    }

    res.status(200).json({
      status: "ok",
      estadisticas: resultados,
    });
  });
});

/*
|--------------------------------------------------------------------------
| ESTADÍSTICAS POR ESTADO (Pendiente vs Resuelto)
|--------------------------------------------------------------------------
| Método: GET
| Ruta: /estadisticas/estados
|--------------------------------------------------------------------------
*/

app.get("/estadisticas/estados", (req, res) => {
  const sql = `
    SELECT estado, COUNT(id) AS total
    FROM incidencias
    GROUP BY estado
  `;

  conexion.query(sql, (error, resultados) => {
    if (error) {
      console.error("Error en estadísticas por estado:", error.message);

      return res.status(500).json({
        status: "error",
        mensaje: "No se pudieron obtener las estadísticas por estado",
      });
    }

    res.status(200).json({
      status: "ok",
      estadisticas: resultados,
    });
  });
});

/*
|--------------------------------------------------------------------------
| REGISTRAR UNA INCIDENCIA
|--------------------------------------------------------------------------
| Método: POST
| Ruta: /incidencias
|
| Se recibe como multipart/form-data:
|   categoria_id: 2
|   descripcion: "Ventilador del aula 5 no funciona"
|   imagen: (archivo opcional)
|--------------------------------------------------------------------------
*/

app.post("/incidencias", upload.single("imagen"), (req, res) => {
  // Obtener la información enviada desde Flutter.
  const { categoria_id, descripcion } = req.body;

  // Convertir el id a número.
  const categoriaId = Number(categoria_id);

  // Limpiar espacios innecesarios.
  const descripcionLimpia =
    typeof descripcion === "string" ? descripcion.trim() : "";

  // Nombre del archivo si el usuario mandó foto.
  const imagen = req.file ? req.file.filename : null;

  /*
  |--------------------------------------------------------------------------
  | VALIDACIONES
  |--------------------------------------------------------------------------
  */

  if (!Number.isInteger(categoriaId) || categoriaId <= 0) {
    return res.status(400).json({
      status: "error",
      mensaje: "Debe seleccionar una categoría válida",
    });
  }

  if (descripcionLimpia.length === 0) {
    return res.status(400).json({
      status: "error",
      mensaje: "La descripción es obligatoria",
    });
  }

  if (descripcionLimpia.length < 10) {
    return res.status(400).json({
      status: "error",
      mensaje: "La descripción debe tener al menos 10 caracteres",
    });
  }

  if (descripcionLimpia.length > 1000) {
    return res.status(400).json({
      status: "error",
      mensaje: "La descripción no puede superar los 1000 caracteres",
    });
  }

  /*
  |--------------------------------------------------------------------------
  | GUARDAR LA INCIDENCIA
  |--------------------------------------------------------------------------
  */

  const sql = `
    INSERT INTO incidencias (
      categoria_id,
      descripcion,
      imagen
    )
    VALUES (?, ?, ?)
  `;

  conexion.query(
    sql,
    [categoriaId, descripcionLimpia, imagen],
    (error, resultado) => {
      if (error) {
        console.error("Error al registrar incidencia:", error.message);

        // La categoría enviada no existe.
        if (error.code === "ER_NO_REFERENCED_ROW_2") {
          return res.status(400).json({
            status: "error",
            mensaje: "La categoría seleccionada no existe",
          });
        }

        return res.status(500).json({
          status: "error",
          mensaje: "No se pudo registrar la incidencia",
        });
      }

      res.status(201).json({
        status: "ok",
        mensaje: "Incidencia registrada correctamente",
        incidencia: {
          id: resultado.insertId,
          categoria_id: categoriaId,
          descripcion: descripcionLimpia,
          imagen: imagen,
          estado: "Pendiente",
        },
      });
    }
  );
});

/*
|--------------------------------------------------------------------------
| ERRORES DE SUBIDA DE ARCHIVOS (tamaño, tipo)
|--------------------------------------------------------------------------
*/

app.use((error, req, res, next) => {
  if (
    error instanceof multer.MulterError ||
    error.message === "Solo se permiten imágenes"
  ) {
    return res.status(400).json({
      status: "error",
      mensaje:
        error.code === "LIMIT_FILE_SIZE"
          ? "La imagen no puede superar los 5 MB"
          : error.message,
    });
  }
  next(error);
});

/*
|--------------------------------------------------------------------------
| RUTA NO ENCONTRADA
|--------------------------------------------------------------------------
| Este bloque debe ir después de todos los endpoints.
|--------------------------------------------------------------------------
*/

app.use((req, res) => {
  res.status(404).json({
    status: "error",
    mensaje: "Ruta no encontrada",
  });
});

/*
|--------------------------------------------------------------------------
| INICIAR SERVIDOR
|--------------------------------------------------------------------------
| Render entrega el puerto mediante process.env.PORT.
| 0.0.0.0 permite que Render detecte el puerto abierto.
|--------------------------------------------------------------------------
*/

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor iniciado en el puerto ${PORT}`);
});