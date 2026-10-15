// Importar librerías.

const express = require("express");

const mysql = require("mysql2");

const cors = require("cors");

const path = require("path");

const multer = require("multer");

const bcrypt = require("bcryptjs");

const jwt = require("jsonwebtoken");

require("dotenv").config();



// Clave secreta para firmar los tokens (se define en Render, no en el código).

const JWT_SECRET = process.env.JWT_SECRET;



if (!JWT_SECRET) {

  console.error("Falta la variable de entorno JWT_SECRET.");

  process.exit(1);

}



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

| MIDDLEWARES DE SEGURIDAD (Guía 6)

|--------------------------------------------------------------------------

*/



// Verifica que la petición traiga un token JWT válido.

const verificarToken = (req, res, next) => {

  const cabecera = req.headers["authorization"] || "";

  const token = cabecera.startsWith("Bearer ")

    ? cabecera.slice(7)

    : cabecera;



  if (!token) {

    return res.status(403).json({

      status: "error",

      mensaje: "Token requerido",

    });

  }



  try {

    req.usuario = jwt.verify(token, JWT_SECRET);

    next();

  } catch (error) {

    return res.status(401).json({

      status: "error",

      mensaje: "Token inválido o expirado",

    });

  }

};



// Permite continuar solo a usuarios con rol Admin.

// El rol se consulta en la base de datos, no solo en el token.

const soloAdmin = (req, res, next) => {

  conexion.query(

    "SELECT rol FROM usuarios WHERE id = ?",

    [req.usuario.id],

    (error, filas) => {

      if (error) {

        console.error("Error al verificar rol:", error.message);



        return res.status(500).json({

          status: "error",

          mensaje: "No se pudo verificar el rol del usuario",

        });

      }



      if (filas.length === 0 || filas[0].rol !== "Admin") {

        return res.status(403).json({

          status: "error",

          mensaje: "Acceso denegado. Se requieren permisos de Administrador.",

        });

      }



      next();

    }

  );

};



/*

|--------------------------------------------------------------------------

| REGISTRO DE USUARIO (Guía 6)

|--------------------------------------------------------------------------

| Método: POST

| Ruta: /registro

| Todos los usuarios nuevos se crean con rol "Usuario".

| Para crear un Admin se cambia el rol directamente en la base de datos.

|--------------------------------------------------------------------------

*/



app.post("/registro", async (req, res) => {

  const nombre =

    typeof req.body.nombre === "string" ? req.body.nombre.trim() : "";

  const email =

    typeof req.body.email === "string"

      ? req.body.email.trim().toLowerCase()

      : "";

  const password =

    typeof req.body.password === "string" ? req.body.password : "";



  if (nombre.length < 2 || nombre.length > 100) {

    return res.status(400).json({

      status: "error",

      mensaje: "El nombre debe tener entre 2 y 100 caracteres",

    });

  }



  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 100) {

    return res.status(400).json({

      status: "error",

      mensaje: "Ingrese un correo electrónico válido",

    });

  }



  if (password.length < 6) {

    return res.status(400).json({

      status: "error",

      mensaje: "La contraseña debe tener al menos 6 caracteres",

    });

  }



  try {

    const passwordCifrada = await bcrypt.hash(password, 10);



    const sql =

      "INSERT INTO usuarios (nombre, email, password, rol) VALUES (?, ?, ?, 'Usuario')";



    conexion.query(sql, [nombre, email, passwordCifrada], (error) => {

      if (error) {

        if (error.code === "ER_DUP_ENTRY") {

          return res.status(409).json({

            status: "error",

            mensaje: "Ese correo ya está registrado",

          });

        }



        console.error("Error al registrar usuario:", error.message);



        return res.status(500).json({

          status: "error",

          mensaje: "No se pudo registrar el usuario",

        });

      }



      res.status(201).json({

        status: "ok",

        mensaje: "Usuario registrado correctamente",

      });

    });

  } catch (error) {

    console.error("Error al cifrar contraseña:", error.message);



    res.status(500).json({

      status: "error",

      mensaje: "Error al procesar el registro",

    });

  }

});



/*

|--------------------------------------------------------------------------

| INICIO DE SESIÓN (Guía 6)

|--------------------------------------------------------------------------

| Método: POST

| Ruta: /login

|--------------------------------------------------------------------------

*/



app.post("/login", (req, res) => {

  const email =

    typeof req.body.email === "string"

      ? req.body.email.trim().toLowerCase()

      : "";

  const password =

    typeof req.body.password === "string" ? req.body.password : "";



  if (email.length === 0 || password.length === 0) {

    return res.status(400).json({

      status: "error",

      mensaje: "Ingrese su correo y contraseña",

    });

  }



  conexion.query(

    "SELECT id, nombre, email, password, rol FROM usuarios WHERE email = ?",

    [email],

    async (error, filas) => {

      if (error) {

        console.error("Error en login:", error.message);



        return res.status(500).json({

          status: "error",

          mensaje: "No se pudo iniciar sesión",

        });

      }



      // Mismo mensaje para correo o contraseña incorrectos.

      const credencialesInvalidas = () =>

        res.status(401).json({

          status: "error",

          mensaje: "Correo o contraseña incorrectos",

        });



      if (filas.length === 0) {

        return credencialesInvalidas();

      }



      const usuario = filas[0];



      const passwordValida = await bcrypt.compare(password, usuario.password);



      if (!passwordValida) {

        return credencialesInvalidas();

      }



      const token = jwt.sign(

        { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol },

        JWT_SECRET,

        { expiresIn: "8h" }

      );



      res.status(200).json({

        status: "ok",

        mensaje: "Inicio de sesión exitoso",

        token,

        usuario: {

          id: usuario.id,

          nombre: usuario.nombre,

          email: usuario.email,

          rol: usuario.rol,

        },

      });

    }

  );

});



/*

|--------------------------------------------------------------------------

| PERFIL DEL USUARIO AUTENTICADO (Guía 8)

|--------------------------------------------------------------------------

| Método: GET

| Ruta: /perfil

| Requiere el encabezado Authorization: Bearer \<token>

|--------------------------------------------------------------------------

*/



app.get("/perfil", verificarToken, (req, res) => {

  const sql = `

    SELECT id, nombre, email, rol, fecha_registro

    FROM usuarios

    WHERE id = ?

  `;



  conexion.query(sql, [req.usuario.id], (error, filas) => {

    if (error) {

      console.error("Error al obtener perfil:", error.message);



      return res.status(500).json({

        status: "error",

        mensaje: "No se pudo obtener el perfil",

      });

    }



    if (filas.length === 0) {

      return res.status(404).json({

        status: "error",

        mensaje: "Usuario no encontrado",

      });

    }



    res.status(200).json({

      status: "ok",

      usuario: filas[0],

    });

  });

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



app.get("/incidencias", verificarToken, (req, res) => {

  // Filtros opcionales (Guía 7): ?buscar=texto&categoria_id=2&estado=Pendiente

  const buscar =

    typeof req.query.buscar === "string" ? req.query.buscar.trim() : "";

  const categoriaTexto =

    typeof req.query.categoria_id === "string" ? req.query.categoria_id : "";

  const estado =

    typeof req.query.estado === "string" ? req.query.estado : "";



  if (categoriaTexto !== "") {

    const categoriaId = Number(categoriaTexto);



    if (!Number.isInteger(categoriaId) || categoriaId <= 0) {

      return res.status(400).json({

        status: "error",

        mensaje: "La categoría del filtro no es válida",

      });

    }

  }



  if (estado !== "" && !["Pendiente", "Resuelto"].includes(estado)) {

    return res.status(400).json({

      status: "error",

      mensaje: "El estado del filtro debe ser Pendiente o Resuelto",

    });

  }



  let sql = `

    SELECT i.id, i.descripcion, i.estado, i.fecha, i.imagen,

           c.nombre AS categoria, u.nombre AS usuario

    FROM incidencias i

    JOIN categorias c ON i.categoria_id = c.id

    LEFT JOIN usuarios u ON i.usuario_id = u.id

    WHERE 1 = 1

  `;



  const parametros = [];



  if (buscar.length > 0) {

    // Escapamos \, % y _ para que se busquen como texto normal.

    const textoSeguro = buscar.slice(0, 100).replace(/[\\%_]/g, "\\$&");



    sql += " AND i.descripcion LIKE ?";

    parametros.push(`%${textoSeguro}%`);

  }



  if (categoriaTexto !== "") {

    sql += " AND i.categoria_id = ?";

    parametros.push(Number(categoriaTexto));

  }



  if (estado !== "") {

    sql += " AND i.estado = ?";

    parametros.push(estado);

  }



  sql += " ORDER BY i.fecha DESC";



  conexion.query(sql, parametros, (error, resultados) => {

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

| EXPORTAR INCIDENCIAS POR RANGO DE FECHAS (Guía 9)

|--------------------------------------------------------------------------

| Método: GET

| Ruta: /incidencias/exportar?fecha_inicio=AAAA-MM-DD&fecha_fin=AAAA-MM-DD

| Las dos fechas son opcionales. Si no se envían, devuelve todo el historial.

|--------------------------------------------------------------------------

*/



app.get("/incidencias/exportar", verificarToken, (req, res) => {

  const fechaInicio =

    typeof req.query.fecha_inicio === "string"

      ? req.query.fecha_inicio.trim()

      : "";

  const fechaFin =

    typeof req.query.fecha_fin === "string"

      ? req.query.fecha_fin.trim()

      : "";



  // Evita consultas incompletas: deben llegar ambas fechas o ninguna.

  if ((fechaInicio === "") !== (fechaFin === "")) {

    return res.status(400).json({

      status: "error",

      mensaje: "Debe enviar la fecha de inicio y la fecha de fin",

    });

  }



  const formatoFecha = /^\d{4}-\d{2}-\d{2}$/;



  if (

    fechaInicio !== "" &&

    (!formatoFecha.test(fechaInicio) || !formatoFecha.test(fechaFin))

  ) {

    return res.status(400).json({

      status: "error",

      mensaje: "Las fechas deben tener el formato AAAA-MM-DD",

    });

  }



  if (fechaInicio !== "" && fechaInicio > fechaFin) {

    return res.status(400).json({

      status: "error",

      mensaje: "La fecha de inicio no puede ser posterior a la fecha de fin",

    });

  }



  let sql = `

    SELECT i.id, i.descripcion, i.estado, i.fecha,

           c.nombre AS categoria, u.nombre AS usuario

    FROM incidencias i

    JOIN categorias c ON i.categoria_id = c.id

    LEFT JOIN usuarios u ON i.usuario_id = u.id

    WHERE 1 = 1

  `;



  const parametros = [];



  if (fechaInicio !== "" && fechaFin !== "") {

    sql += " AND DATE(i.fecha) BETWEEN ? AND ?";

    parametros.push(fechaInicio, fechaFin);

  }



  sql += " ORDER BY i.fecha DESC";



  conexion.query(sql, parametros, (error, resultados) => {

    if (error) {

      console.error("Error al exportar incidencias:", error.message);



      return res.status(500).json({

        status: "error",

        mensaje: "No se pudieron obtener los datos para el reporte",

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



app.get("/incidencias/resueltas", verificarToken, (req, res) => {

  const sql = `

    SELECT i.id, i.descripcion, i.estado, i.fecha, i.imagen,

           c.nombre AS categoria, u.nombre AS usuario

    FROM incidencias i

    JOIN categorias c ON i.categoria_id = c.id

    LEFT JOIN usuarios u ON i.usuario_id = u.id

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



app.put("/incidencias/:id/estado", verificarToken, soloAdmin, (req, res) => {

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



app.delete("/incidencias/:id", verificarToken, soloAdmin, (req, res) => {

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



app.get("/estadisticas/categorias", verificarToken, (req, res) => {

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



app.get("/estadisticas/estados", verificarToken, (req, res) => {

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



app.post("/incidencias", verificarToken, upload.single("imagen"), (req, res) => {

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

        usuario_id,

        categoria_id,

        descripcion,

        imagen

      )

      VALUES (?, ?, ?, ?)

    `;



    conexion.query(

      sql,

      [req.usuario.id, categoriaId, descripcionLimpia, nombreImagen],

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
