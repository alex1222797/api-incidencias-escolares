// Importar librerías.
const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
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
      console.error(
        "Error al obtener categorías:",
        error.message
      );

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
| REGISTRAR UNA INCIDENCIA
|--------------------------------------------------------------------------
| Método: POST
| Ruta: /incidencias
|
| JSON esperado:
| {
|   "categoria_id": 2,
|   "descripcion": "Ventilador del aula 5 no funciona"
| }
|--------------------------------------------------------------------------
*/

app.post("/incidencias", (req, res) => {
  // Obtener la información enviada desde Flutter.
  const { categoria_id, descripcion } = req.body;

  // Convertir el id a número.
  const categoriaId = Number(categoria_id);

  // Limpiar espacios innecesarios.
  const descripcionLimpia =
    typeof descripcion === "string"
      ? descripcion.trim()
      : "";

  /*
  |--------------------------------------------------------------------------
  | VALIDACIONES
  |--------------------------------------------------------------------------
  */

  if (
    !Number.isInteger(categoriaId) ||
    categoriaId <= 0
  ) {
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
      mensaje:
        "La descripción debe tener al menos 10 caracteres",
    });
  }

  if (descripcionLimpia.length > 1000) {
    return res.status(400).json({
      status: "error",
      mensaje:
        "La descripción no puede superar los 1000 caracteres",
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
      descripcion
    )
    VALUES (?, ?)
  `;

  conexion.query(
    sql,
    [categoriaId, descripcionLimpia],
    (error, resultado) => {
      if (error) {
        console.error(
          "Error al registrar incidencia:",
          error.message
        );

        // La categoría enviada no existe.
        if (error.code === "ER_NO_REFERENCED_ROW_2") {
          return res.status(400).json({
            status: "error",
            mensaje:
              "La categoría seleccionada no existe",
          });
        }

        return res.status(500).json({
          status: "error",
          mensaje:
            "No se pudo registrar la incidencia",
        });
      }

      res.status(201).json({
        status: "ok",
        mensaje:
          "Incidencia registrada correctamente",
        incidencia: {
          id: resultado.insertId,
          categoria_id: categoriaId,
          descripcion: descripcionLimpia,
          estado: "Pendiente",
        },
      });
    }
  );
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