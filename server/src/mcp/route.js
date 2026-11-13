/**
 * MCP endpoint for AI assistants: POST /mcp (Streamable HTTP, stateless).
 *
 * Every request must carry `Authorization: Bearer <token>`: an OAuth access
 * token (assistant connected with "Sign in with Microsoft") or a personal
 * access token from the profile page. Without one the answer is 401 with the
 * OAuth discovery link, as the MCP authorization spec requires.
 */
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { actorFromBearer } from '../auth/tokens.js';
import { SCOPE, resourceMetadataUrl } from '../auth/oauth.js';
import { buildMcpServer } from './tools.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, WWW-Authenticate',
};

export default async function mcpRoutes(fastify) {
  fastify.options('/mcp', async (request, reply) => reply.headers(CORS).code(204).send());

  fastify.post('/mcp', async (request, reply) => {
    const actor = await actorFromBearer(request);
    if (!actor) {
      return reply
        .headers(CORS)
        .header(
          'WWW-Authenticate',
          `Bearer resource_metadata="${resourceMetadataUrl()}", scope="${SCOPE}"`
        )
        .code(401)
        .send({
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Sign in required (missing or invalid token)' },
          id: null,
        });
    }

    const server = buildMcpServer(actor);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless: every request stands alone
      enableJsonResponse: true,
    });

    reply.hijack();
    Object.entries(CORS).forEach(([k, v]) => reply.raw.setHeader(k, v));
    reply.raw.on('close', () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch (error) {
      request.log.error({ err: error }, 'MCP request failed');
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'Content-Type': 'application/json' });
        reply.raw.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          })
        );
      }
    }
    return reply;
  });

  // Stateless server: no server-initiated streams or sessions to end.
  const notAllowed = async (request, reply) =>
    reply
      .headers(CORS)
      .header('Allow', 'POST, OPTIONS')
      .code(405)
      .send({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed' },
        id: null,
      });
  fastify.get('/mcp', notAllowed);
  fastify.delete('/mcp', notAllowed);
}
