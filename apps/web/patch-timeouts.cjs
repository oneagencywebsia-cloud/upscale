// Se carga con `node --require` ANTES de arrancar `server.js` (la salida
// standalone que genera Next.js en cada build — no es un archivo que se pueda
// editar a mano, se regenera siempre). Next.js no expone ninguna opción de
// config para los timeouts del `http.Server` interno, y ese servidor hereda
// los valores por defecto de Node: `requestTimeout` corta cualquier petición
// que tarde más de 5 minutos en llegar ENTERA con un 408 — justo lo que le
// pasaba a una subida de vídeo grande por una conexión doméstica normal, ya
// con el timeout del proxy de por medio arreglado.
//
// Se intercepta `http.createServer` en vez de tocar el `server.js` generado
// porque su estructura interna no es estable entre versiones de Next; esto
// funciona sea cual sea esa estructura, mientras siga usando el `http` nativo
// de Node (lo hace: es justo lo que usa el server.js de `output: "standalone"`).
const http = require("node:http");

const originalCreateServer = http.createServer;
http.createServer = function patchedCreateServer(...args) {
  const server = originalCreateServer.apply(this, args);
  server.requestTimeout = 0; // 0 = sin tope (antes: 300000ms por defecto de Node)
  server.headersTimeout = 0;
  server.keepAliveTimeout = 65_000; // por encima de cualquier keep-alive de proxy intermedio
  return server;
};
