const authController = require("../controllers/auth.controller");
const express = require("express");
const auth_router = express.Router();

router.post("/register", authController.register);
router.post("/login", authController.login);
router.post("/refresh", authController.refresh);
router.post("/logout", authController.logout);


module.exports = auth_router;