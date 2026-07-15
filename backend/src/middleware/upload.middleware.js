const multer = require("multer");
const { fileTypeFromBuffer } = require("file-type");
const ApiError = require("../utils/ApiError");
const STATUS_CODES = require("../constants/statusCodes");

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE_MB = 5;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

const fileFilter = (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        return cb(
            new ApiError(
                STATUS_CODES.BAD_REQUEST,
                "Only JPG, PNG, and WEBP images are allowed"
            )
        );
    }

    cb(null, true);
};

const multer_instance = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE_BYTES },
    fileFilter,
});

// wraps multer's callback-style error so a bad request always comes out as
// an ApiError the shared error_handler already knows how to render
const uploadSingleImage = (req, res, next) => {
    multer_instance.single("image")(req, res, (err) => {
        if (!err) {
            return next();
        }

        if (err instanceof ApiError) {
            return next(err);
        }

        if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
            return next(
                new ApiError(
                    STATUS_CODES.BAD_REQUEST,
                    `File too large. Max size is ${MAX_FILE_SIZE_MB}MB`
                )
            );
        }

        return next(new ApiError(STATUS_CODES.BAD_REQUEST, err.message));
    });
};

// declared mimetype on the multipart request is client-controlled and easy to spoof,
// so the real check is sniffing the actual file bytes once they're buffered
const verifyImageSignature = async (req, res, next) => {
    try {
        if (!req.file) {
            throw new ApiError(STATUS_CODES.BAD_REQUEST, "No image file uploaded");
        }

        const detected_type = await fileTypeFromBuffer(req.file.buffer);

        if (!detected_type || !ALLOWED_MIME_TYPES.includes(detected_type.mime)) {
            throw new ApiError(
                STATUS_CODES.BAD_REQUEST,
                "File content does not match an allowed image type (JPG, PNG, WEBP)"
            );
        }

        req.file.detected_mime_type = detected_type.mime;
        next();
    } catch (err) {
        next(err);
    }
};

module.exports = {
    ALLOWED_MIME_TYPES,
    MAX_FILE_SIZE_BYTES,
    uploadSingleImage,
    verifyImageSignature,
};
