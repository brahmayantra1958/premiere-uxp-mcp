/* global window, require */
(function () {
  "use strict";
  var nodeRequire = typeof require === "function" ? require : window.cep_node.require;
  var fs = nodeRequire("fs"), path = nodeRequire("path"), processModule = nodeRequire("process");
  var config = window.BrahmaYantraProjectSelectionConfig;
  var service = nodeRequire(path.join(config.installation, "service.cjs"));
  var evidence = path.join(config.repositoryRoot, "artifacts/runtime/project-selection-helper-ready.json");
  function record(value) { fs.writeFileSync(evidence, JSON.stringify({ extensionId: config.extensionId, version: "0.1.1", pid: processModule.pid, port: config.port, updatedAt: new Date().toISOString(), observation: value }, null, 2)); }
  var server = service.createProjectSelectionServer(config, function (script, callback) { window.__adobe_cep__.evalScript(script, callback); }, record);
  server.on("error", function (error) { record({ status: "fail", error: String(error) }); });
  server.listen(config.port, "127.0.0.1", function () { record({ status: "listening" }); });
  window.addEventListener("unload", function () { server.close(); });
}());
