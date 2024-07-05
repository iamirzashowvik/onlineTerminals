const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const Docker = require("dockerode");
const tar = require("tar-stream");
const stream = require("stream");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const docker = new Docker({ socketPath: "/var/run/docker.sock" });

app.use(express.static("public"));

io.on("connection", (socket) => {
  console.log("User connected");

  let container = null;
  let exec = null;

  socket.on("start", async (data) => {
    const { language, code } = data;
    console.log(`Received start request for language: ${language}`);
    const image = getImageForLanguage(language);
    if (!image) {
      socket.emit("output", "Unsupported language");
      return;
    }

    try {
      container = await docker.createContainer({
        Image: image,
        Cmd: ["/bin/bash"],
        Tty: true,
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        OpenStdin: true,
        StdinOnce: false,
      });

      await container.start();
      console.log(`Container started for ${language}`);

      const codeFilePath = getCodeFilePath(language);
      const execCodeCmd = getExecCommand(language, codeFilePath);

      // Create tar archive with code file
      const pack = tar.pack();
      pack.entry({ name: codeFilePath }, code);
      pack.finalize();

      container.putArchive(pack, { path: "/" }, async (err, response) => {
        if (err) {
          console.error(`Error uploading code: ${err.message}`);
          socket.emit("output", `Error: ${err.message}`);
          return;
        }

        exec = await container.exec({
          AttachStdin: true,
          AttachStdout: true,
          AttachStderr: true,
          Cmd: ["/bin/bash", "-c", execCodeCmd],
          Tty: false,
        });

        const execStream = await exec.start({
          hijack: true,
          stdin: true,
          stdout: true,
          stderr: true,
        });

        execStream.on("data", (chunk) => {
          console.log(`Container output: ${chunk.toString()}`);
          socket.emit("output", chunk.toString());
        });

        execStream.on("end", () => {
          console.log("Exec stream ended");
        });

        socket.on("input", (data) => {
          console.log(`Received input: ${data}`);
          if (execStream) {
            execStream.write(data + "\n");
          }
        });

        container.wait().then(() => {
          socket.emit("output", "Container stopped");
          container.remove();
        });
      });
    } catch (err) {
      console.error(`Error: ${err.message}`);
      socket.emit("output", `Error: ${err.message}`);
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected");
    if (container) {
      container.stop();
    }
  });
});

const getImageForLanguage = (language) => {
  const images = {
    python: "python",
    node: "node",
    cpp: "gcc",
    // java: "openjdk:11",
    // Add more languages and their Docker images
  };
  return images[language];
};

const getCodeFilePath = (language) => {
  const filePaths = {
    python: "/code.py",
    node: "/code.js",
    cpp: "/code.cpp",
    // java: "/HelloWorld.java",
    // Add more file paths for other languages
  };
  return filePaths[language];
};

const getExecCommand = (language, filePath) => {
  const commands = {
    python: `python ${filePath}`,
    node: `node ${filePath}`,
    cpp: `g++ ${filePath} && ./a.out`,
    // java: `javac ${filePath} && java HelloWorld`,
    // Add more execution commands for other languages
  };
  return commands[language];
};

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
