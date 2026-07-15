const express = require("express");
const auth_controller = require("../controllers/auth.controller");
const validate = require("../middleware/validate.middleware");
const { signup_schema, login_schema } = require("../validations/auth.validation");

const auth_router = express.Router();

auth_router.post("/signup", validate(signup_schema), auth_controller.register);
auth_router.post("/login", validate(login_schema), auth_controller.login);
auth_router.post("/refresh", auth_controller.refresh);
auth_router.post("/logout", auth_controller.logout);

module.exports = auth_router;
