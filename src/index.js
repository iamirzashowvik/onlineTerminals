const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const Docker = require("dockerode");
const tar = require("tar-stream");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const docker = new Docker({ socketPath: "/var/run/docker.sock" });

app.use(express.static("public"));

io.on("connection", (socket) => {
  console.log("User connected");

  let container = null;

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

        const exec = await container.exec({
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
          socket.emit("output", chunk.toString());
        });

        execStream.on("error", (error) => {
          socket.emit("output", `Error: ${error.message}`);
        });

        execStream.on("end", () => {
          socket.emit("output", "Execution completed");
        });

        socket.on("input", (data) => {
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

  socket.on("install", async (data) => {
    const { language, libraries } = data;
    const installCmd = getInstallCommand(language, libraries);
    if (!installCmd) {
      socket.emit("output", "Unsupported language for library installation");
      return;
    }

    try {
      if (!container) {
        socket.emit("output", "Container not available");
        return;
      }

      const exec = await container.exec({
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Cmd: ["/bin/bash", "-c", installCmd],
        Tty: false,
      });

      const execStream = await exec.start({
        hijack: true,
        stdin: true,
        stdout: true,
        stderr: true,
      });

      execStream.on("data", (chunk) => {
        socket.emit("output", chunk.toString());
      });

      execStream.on("error", (error) => {
        socket.emit("output", `Error: ${error.message}`);
      });

      execStream.on("end", () => {
        socket.emit("output", "Library installation complete");
      });
    } catch (err) {
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
    c: "gcc",
    kotlin: "openjdk",
    java: "openjdk",
    // Add more languages and their Docker images
  };
  return images[language];
};

const getCodeFilePath = (language) => {
  const filePaths = {
    python: "/code.py",
    node: "/code.js",
    cpp: "/code.cpp",
    c: "/code.c",
    kotlin: "/code.kt",
    java: "/HelloWorld.java",
    // Add more file paths for other languages
  };
  return filePaths[language];
};

const getExecCommand = (language, filePath) => {
  const commands = {
    python: `python ${filePath}`,
    node: `node ${filePath}`,
    cpp: `g++ ${filePath} && ./a.out`,
    c: `g++ ${filePath} && ./a.out`,
    kotlin: `kotlinc ${filePath} -include-runtime -d code.jar && java -jar code.jar`,
    java: `javac ${filePath} && java HelloWorld`,
    // Add more execution commands for other languages
  };
  return commands[language];
};

const getInstallCommand = (language, libraries) => {
  const commands = {
    python: `pip install ${libraries.join(
      " "
    )} --target /usr/local/lib/python3.8/site-packages/`,
    node: `npm install -g ${libraries.join(" ")}`,
    // Add more commands for other languages
  };
  return commands[language];
};

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
