import type { Request, Response } from "express";
import { validationResult } from "express-validator";
import slug from "slug";
import formidable from "formidable";
import { v4 as uuid } from "uuid";
import User from "../models/User";
import { checkPassword, hashPassword } from "../utils/auth";
import { generateJWT } from "../utils/jwt";
import cloudinary from "../config/cloudinary";
import QRCode from "qrcode"; // Importar la librería QRCode

export const createAccount = async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const userExists = await User.findOne({ email });
  if (userExists) {
    const error = new Error("Un usuario con ese mail ya esta registrado");
    return res.status(409).json({ error: error.message });
  }
  const handle = slug(req.body.handle, "");
  const handleExists = await User.findOne({ handle });
  if (handleExists) {
    const error = new Error("Nombre de usuario no disponible");
    return res.status(409).json({ error: error.message });
  }
  const user = new User(req.body);
  user.password = await hashPassword(password);
  user.handle = handle;
  await user.save();
  res.status(201).send("Registro Creado Correctamente");
};

export const login = async (req: Request, res: Response) => {
  // Manejar errores
  let errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  const { email, password } = req.body;
  // Revisar si el usuario esta registrado
  const user = await User.findOne({ email });
  if (!user) {
    const error = new Error("El Usuario no existe");
    return res.status(404).json({ error: error.message });
  }
  // Comprobar el password
  const isPasswordCorrect = await checkPassword(password, user.password);
  if (!isPasswordCorrect) {
    const error = new Error("Password Incorrecto");
    return res.status(401).json({ error: error.message });
  }
  const token = generateJWT({ id: user._id });
  res.send(token);
};

export const getUser = async (req: Request, res: Response) => {
  res.json(req.user);
};

export const updateProfile = async (req: Request, res: Response) => {
  try {
    const { description, links } = req.body;
    const handle = slug(req.body.handle, "");
    const handleExists = await User.findOne({ handle });
    if (handleExists && handleExists.email !== req.user.email) {
      const error = new Error("Nombre de usuario no disponible");
      return res.status(409).json({ error: error.message });
    }
    // Actualizar el usuario
    req.user.description = description;
    req.user.handle = handle;
    req.user.links = links;
    await req.user.save();
    res.send("Perfil Actualizado Correctamente");
  } catch (e) {
    const error = new Error("Hubo un error");
    return res.status(500).json({ error: error.message });
  }
};

export const uploadImage = async (req: Request, res: Response) => {
  const form = formidable({ multiples: false });
  try {
    form.parse(req, (error, fields, files) => {
      cloudinary.uploader.upload(
        files.file[0].filepath,
        { public_id: uuid() },
        async function (error, result) {
          if (error) {
            const error = new Error("Hubo un error al subir la imagen");
            return res.status(500).json({ error: error.message });
          }
          if (result) {
            req.user.image = result.secure_url;
            await req.user.save();
            res.json({ image: result.secure_url });
          }
        }
      );
    });
  } catch (e) {
    const error = new Error("Hubo un error");
    return res.status(500).json({ error: error.message });
  }
};

export const getUserByHandle = async (req: Request, res: Response) => {
  try {
    const { handle } = req.params;

    // CORRECCIÓN 1: No usamos .select() aquí. Necesitamos el objeto completo (incluido el _id)
    // para que el método .save() funcione.
    const user = await User.findOne({ handle });

    if (!user) {
      const error = new Error("El Usuario no existe");
      return res.status(404).json({ error: error.message });
    }

    // Incrementamos visitas
    // @ts-ignore
    user.visits = (user.visits || 0) + 1;

    // Guardamos
    await user.save();

    // Limpiamos los datos sensibles manualmente antes de enviarlo
    // Convertimos el documento de Mongoose a un objeto simple de JS
    const userResponse = user.toObject();

    // Eliminamos los campos que no queremos que se vean en el frontend
    // @ts-ignore
    delete userResponse.password;
    // @ts-ignore
    delete userResponse.email;
    // @ts-ignore
    delete userResponse.__v;
    // @ts-ignore
    delete userResponse._id;

    // Devolvemos el usuario limpio
    res.json(userResponse);
  } catch (e) {
    const error = new Error("Hubo un error");
    return res.status(500).json({ error: error.message });
  }
};

export const searchByHandle = async (req: Request, res: Response) => {
  try {
    const { handle } = req.body;
    const userExists = await User.findOne({ handle });
    if (userExists) {
      const error = new Error(`${handle} ya está registrado`);
      return res.status(409).json({ error: error.message });
    }
    res.send(`${handle} está disponible`);
  } catch (e) {
    const error = new Error("Hubo un error");
    return res.status(500).json({ error: error.message });
  }
};

// Nuevo controlador para generar código QR para el perfil del usuario
export const generateQR = async (req: Request, res: Response) => {
  try {
    // Validación para asegurarse de que el usuario esté autenticado (middleware auth ya aplicado)
    const profileUrl = `https://peterbernuy.netlify.app/${req.user.handle}`; // URL pública del perfil (ajusta a producción)

    // Genera QR usando qrcode para sharing offline
    const qrData = await QRCode.toDataURL(profileUrl, {
      errorCorrectionLevel: "H", // Alta corrección para robustez
      type: "image/png",
      margin: 1,
      color: {
        dark: "#0e7490",
        light: "#ffffff",
      },
    });

    // Almacenar en modelo para cache (evita regenerar siempre)
    req.user.qrCode = qrData;
    await req.user.save();

    // Devuelve base64 para frontend
    res.json({ qrCode: qrData });
  } catch (e) {
    // Manejo de errores con validación
    const error = new Error("Error al generar QR");
    return res.status(500).json({ error: error.message });
  }
};
