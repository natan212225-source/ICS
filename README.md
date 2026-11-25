# ICS Lost & Found / Backed Customers — Full-stack (React + Express + Prisma)
Server: `cd server && npm i && npm run db && npm run seed && npm run dev`   (API :4000)
Client: `cd client && npm i && npm run dev`   (http://localhost:5173)
Login: admin / Admin@123. Create Verifier / L&F Officer / Admin users in "Admin & Audit".
Database: permanent SQLite file server/prisma/ics.db. For PostgreSQL/MySQL change `provider` in prisma/schema.prisma and DATABASE_URL in server/.env, then `npm run db && npm run seed`.
