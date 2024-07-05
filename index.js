const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const Docker = require("dockerode");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const docker = new Docker();

app.use(express.static("public"));

io.on("connection", (socket) => {
  console.log("User connected");

  socket.on("start", async (language) => {
    const image = getImageForLanguage(language);
    if (!image) {
      socket.emit("output", "Unsupported language");
      return;
    }

    try {
      const container = await docker.createContainer({
        Image: image,
        Cmd: ["/bin/sh"],
        Tty: true,
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        OpenStdin: true,
        StdinOnce: false,
      });

      await container.start();
      const stream = await container.attach({
        stream: true,
        stdin: true,
        stdout: true,
        stderr: true,
      });

      socket.on("input", (data) => {
        stream.write(data);
      });

      stream.on("data", (chunk) => {
        socket.emit("output", chunk.toString());
      });

      container.wait().then(() => {
        socket.emit("output", "Container stopped");
        container.remove();
      });
    } catch (err) {
      socket.emit("output", `Error: ${err.message}`);
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected");
  });
});

const getImageForLanguage = (language) => {
  const images = {
    python: "python",
    // node: "node",
    // java: "openjdk",
    // Add more languages and their Docker images
  };
  return images[language];
};

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
