//importar librerias 
const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
require("dotenv").config();

//creacion de la app en express
const app = express();
app.use(cors());
app.use(express.json());

//conexion con aiven
const conexion = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    name: process.env.DB_NAME,


    ssl:{
        rejectUnauthorized: false,
    },

    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
});


//comprobar conexion con la base de datos
conexion.getConnection((error, conexion) =>{
    if (error){
        console.error("Error al conectar con Aiven:");
        console.error(error.message);
        return;
    }

    console.log("Conexion exitosa con MySQL en Aiven");
    conexion.release();
});

//ruta principal
app.get("/", (req , res) =>{
    res.status(200).json({
        status: "ok" ,
        mensaje: "API de incidencias funcionando correctamente",
    });
});
