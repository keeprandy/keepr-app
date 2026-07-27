import fs from "fs";
import path from "path";

export default function handler(_req, res) {
  const imagePath = path.join(process.cwd(), "assets", "kog", "member-node-default.png");

  if (!fs.existsSync(imagePath)) {
    return res.status(404).send("Not found");
  }

  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400");
  return res.status(200).send(fs.readFileSync(imagePath));
}

