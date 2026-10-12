// Importar librerías.
const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const path = require("path");
const multer = require("multer");
require("dotenv").config();

// Crear la aplicación de Express.
const app = express();

// Permitir solicitudes desde Flutter.
app.use(cors());

// Permitir que Express reciba información JSON.
app.use(express.json());

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
| Las imágenes se reciben en memoria y se guardan en la tabla `imagenes`
| de MySQL, así no se pierden cuando Render reinicia el servidor.
|--------------------------------------------------------------------------
*/

const TIPOS_POR_EXTENSION = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

const EXTENSIONES_PERMITIDAS = Object.keys(TIPOS_POR_EXTENSION);

const upload = multer({
  storage: multer.memoryStorage(),
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
| SERVIR IMÁGENES DESDE MYSQL
|--------------------------------------------------------------------------
| Método: GET
| Ruta: /uploads/:nombre
|--------------------------------------------------------------------------
*/

app.get("/uploads/:nombre", (req, res) => {
  const nombre = path.basename(req.params.nombre);

  const sql = "SELECT tipo, datos FROM imagenes WHERE nombre = ?";

  conexion.query(sql, [nombre], (error, filas) => {
    if (error) {
      console.error("Error al obtener imagen:", error.message);

      return res.status(500).json({
        status: "error",
        mensaje: "No se pudo obtener la imagen",
      });
    }

    if (filas.length === 0) {
      return res.status(404).json({
        status: "error",
        mensaje: "Imagen no encontrada",
      });
    }

    res.set("Content-Type", filas[0].tipo);
    res.set("Cache-Control", "public, max-age=86400");
    res.status(200).send(filas[0].datos);
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
| OBTENER INCIDENCIAS RESUELTAS (Guía 4)
|--------------------------------------------------------------------------
| Método: GET
| Ruta: /incidencias/resueltas
|--------------------------------------------------------------------------
*/

app.get("/incidencias/resueltas", (req, res) => {
  const sql = `
    SELECT i.id, i.descripcion, i.estado, i.fecha, i.imagen,
           c.nombre AS categoria
    FROM incidencias i
    JOIN categorias c ON i.categoria_id = c.id
    WHERE i.estado = 'Resuelto'
    ORDER BY i.fecha DESC
  `;

  conexion.query(sql, (error, resultados) => {
    if (error) {
      console.error("Error al obtener resueltas:", error.message);

      return res.status(500).json({
        status: "error",
        mensaje: "No se pudieron obtener las incidencias resueltas",
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
| CAMBIAR ESTADO DE UNA INCIDENCIA (Guía 4)
|--------------------------------------------------------------------------
| Método: PUT
| Ruta: /incidencias/:id/estado
|
| JSON esperado:
| {
|   "estado": "Resuelto"
| }
|--------------------------------------------------------------------------
*/

app.put("/incidencias/:id/estado", (req, res) => {
  const incidenciaId = Number(req.params.id);
  const estado = typeof req.body.estado === "string" ? req.body.estado : "";

  const estadosPermitidos = ["Pendiente", "Resuelto"];

  if (!Number.isInteger(incidenciaId) || incidenciaId <= 0) {
    return res.status(400).json({
      status: "error",
      mensaje: "El id de la incidencia no es válido",
    });
  }

  if (!estadosPermitidos.includes(estado)) {
    return res.status(400).json({
      status: "error",
      mensaje: "El estado debe ser Pendiente o Resuelto",
    });
  }

  const sql = "UPDATE incidencias SET estado = ? WHERE id = ?";

  conexion.query(sql, [estado, incidenciaId], (error, resultado) => {
    if (error) {
      console.error("Error al cambiar estado:", error.message);

      return res.status(500).json({
        status: "error",
        mensaje: "No se pudo actualizar el estado",
      });
    }

    if (resultado.affectedRows === 0) {
      return res.status(404).json({
        status: "error",
        mensaje: "La incidencia no existe",
      });
    }

    res.status(200).json({
      status: "ok",
      mensaje: "Estado actualizado correctamente",
    });
  });
});

/*
|--------------------------------------------------------------------------
| ELIMINAR UNA INCIDENCIA (Guía 5)
|--------------------------------------------------------------------------
| Método: DELETE
| Ruta: /incidencias/:id
| También elimina su imagen guardada en la tabla `imagenes`.
|--------------------------------------------------------------------------
*/

app.delete("/incidencias/:id", (req, res) => {
  const incidenciaId = Number(req.params.id);

  if (!Number.isInteger(incidenciaId) || incidenciaId <= 0) {
    return res.status(400).json({
      status: "error",
      mensaje: "El id de la incidencia no es válido",
    });
  }

  // Primero obtenemos el nombre de la imagen (si tiene).
  conexion.query(
    "SELECT imagen FROM incidencias WHERE id = ?",
    [incidenciaId],
    (errorBuscar, filas) => {
      if (errorBuscar) {
        console.error("Error al buscar incidencia:", errorBuscar.message);

        return res.status(500).json({
          status: "error",
          mensaje: "No se pudo eliminar la incidencia",
        });
      }

      if (filas.length === 0) {
        return res.status(404).json({
          status: "error",
          mensaje: "La incidencia no existe",
        });
      }

      const nombreImagen = filas[0].imagen;

      conexion.query(
        "DELETE FROM incidencias WHERE id = ?",
        [incidenciaId],
        (errorEliminar) => {
          if (errorEliminar) {
            console.error(
              "Error al eliminar incidencia:",
              errorEliminar.message
            );

            return res.status(500).json({
              status: "error",
              mensaje: "No se pudo eliminar la incidencia",
            });
          }

          // Eliminamos también la imagen guardada.
          if (nombreImagen) {
            conexion.query(
              "DELETE FROM imagenes WHERE nombre = ?",
              [nombreImagen],
              (errorImagen) => {
                if (errorImagen) {
                  console.error(
                    "Error al eliminar imagen:",
                    errorImagen.message
                  );
                }
              }
            );
          }

          res.status(200).json({
            status: "ok",
            mensaje: "Incidencia eliminada correctamente",
          });
        }
      );
    }
  );
});

/*
|--------------------------------------------------------------------------
| ESTADÍSTICAS POR CATEGORÍA (Guía 3)
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
| ESTADÍSTICAS POR ESTADO (Guía 3)
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
  | PREPARAR LA IMAGEN (si el usuario mandó foto)
  |--------------------------------------------------------------------------
  */

  let nombreImagen = null;
  let tipoImagen = null;

  if (req.file) {
    let extension = path.extname(req.file.originalname).toLowerCase();

    // Algunos celulares envían la foto sin extensión: usamos .jpg.
    if (!EXTENSIONES_PERMITIDAS.includes(extension)) {
      extension = ".jpg";
    }

    nombreImagen = `${Date.now()}${extension}`;

    tipoImagen = req.file.mimetype.startsWith("image/")
      ? req.file.mimetype
      : TIPOS_POR_EXTENSION[extension];
  }

  /*
  |--------------------------------------------------------------------------
  | GUARDAR LA INCIDENCIA
  |--------------------------------------------------------------------------
  */

  const guardarIncidencia = () => {
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
      [categoriaId, descripcionLimpia, nombreImagen],
      (error, resultado) => {
        if (error) {
          console.error("Error al registrar incidencia:", error.message);

          // Si falló, borramos la imagen que ya se había guardado.
          if (nombreImagen) {
            conexion.query(
              "DELETE FROM imagenes WHERE nombre = ?",
              [nombreImagen],
              () => {}
            );
          }

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
            imagen: nombreImagen,
            estado: "Pendiente",
          },
        });
      }
    );
  };

  // Sin foto: guardamos directamente la incidencia.
  if (!req.file) {
    return guardarIncidencia();
  }

  // Con foto: primero guardamos la imagen en MySQL.
  conexion.query(
    "INSERT INTO imagenes (nombre, tipo, datos) VALUES (?, ?, ?)",
    [nombreImagen, tipoImagen, req.file.buffer],
    (errorImagen) => {
      if (errorImagen) {
        console.error("Error al guardar imagen:", errorImagen.message);

        return res.status(500).json({
          status: "error",
          mensaje: "No se pudo guardar la imagen",
        });
      }

      guardarIncidencia();
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