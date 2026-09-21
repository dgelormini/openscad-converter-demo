import OpenScad from "https://code4fukui.github.io/scad2stl/openscad.js";

self.onmessage = async (e) => {
  const { code, format } = e.data;
  let logs = [];

  try {
    const instance = await OpenScad({
        noInitialRun: true,
        print: (text) => logs.push(text),
        printErr: (text) => logs.push(text)
    });

    instance.FS.writeFile("/input.scad", code);
    const ext = format === '3mf' ? '3mf' : 'stl';
    const outFile = `/output.${ext}`;

    try {
        // Run compiler. If code has errors, Emscripten throws a C++ pointer here.
        instance.callMain(["/input.scad", "-o", outFile]);
    } catch (err) {
        // We catch the exit(1) abort pointer silently.
        // The syntax errors are safely captured in the `logs` array via printErr.
    }

    try {
        // If the file exists, compile succeeded despite any warnings
        const fileData = instance.FS.readFile(outFile);
        self.postMessage({ success: true, format, buffer: fileData, logs }, [fileData.buffer]);
    } catch(err) {
        // If file doesn't exist, it truly failed
        self.postMessage({ success: false, error: "Syntax Error.", logs });
    }

  } catch (err) {
    self.postMessage({ success: false, error: err.toString(), logs });
  }
};
