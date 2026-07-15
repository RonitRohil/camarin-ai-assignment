const { PrismaClient } = require("../../generated/prisma");
const { PrismaPg } = require("@prisma/adapter-pg");
const env = require("../config/env");

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

const prisma_client = new PrismaClient({ adapter });

module.exports = prisma_client;
