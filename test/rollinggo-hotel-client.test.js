import assert from "node:assert/strict";
import test from "node:test";
import {
  createRollingGoHotelClient,
  normalizeRollingGoHotel,
  normalizeRoomRatePlan,
} from "../src/rollinggo-hotel-client.js";

function rpcResponse(id, result, headers = {}) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("RollingGo MCP discovers tools, sends bounded arguments and normalizes room inventory", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url: String(url), headers: options.headers, body });
    if (body.method === "initialize") {
      return rpcResponse(body.id, {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "rollinggo-hotel", version: "1.0.0" },
      }, { "mcp-session-id": "session-123" });
    }
    if (body.method === "notifications/initialized") {
      return new Response(null, { status: 202 });
    }
    if (body.method === "tools/list") {
      const payload = JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          tools: [
            {
              name: "getHotelSearchTags",
              description: "获取酒店搜索标签元数据",
              inputSchema: { type: "object", properties: {} },
            },
            {
              name: "search_hotels",
              description: "按城市搜索酒店",
              inputSchema: {
                type: "object",
                properties: {
                  originQuery: { type: "string" },
                  place: { type: "string" },
                  placeType: { type: "string" },
                  size: { type: "number" },
                  checkInParam: {
                    type: "object",
                    properties: {
                      checkInDate: { type: "string" },
                      stayNights: { type: "number" },
                      adultCount: { type: "number" },
                    },
                  },
                },
              },
            },
            {
              name: "get_hotel_detail",
              description: "查询酒店房型、房价与房态",
              inputSchema: {
                type: "object",
                properties: {
                  hotelId: { type: "string" },
                  dateParam: {
                    type: "object",
                    properties: {
                      checkInDate: { type: "string" },
                      checkOutDate: { type: "string" },
                    },
                  },
                  occupancyParam: {
                    type: "object",
                    properties: {
                      roomCount: { type: "number" },
                      adultCount: { type: "number" },
                    },
                  },
                },
              },
            },
          ],
        },
      });
      return new Response(`event: message\ndata: ${payload}\n\n`, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }
    if (body.method === "tools/call" && body.params.name === "search_hotels") {
      return rpcResponse(body.id, {
        structuredContent: {
          hotelInformationList: [{
            hotelId: "provider-1",
            name: "杭州西湖测试酒店",
            address: "杭州市西湖区测试路",
            latitude: 30.25,
            longitude: 120.15,
            starRating: 4,
            tags: ["近景区", "含早餐"],
            imageUrl: "https://images.example/hotel.jpg",
            bookingUrl: "https://booking.example/hotel-1",
            price: { lowestPrice: 680 },
            distanceInMeters: 900,
          }],
        },
      });
    }
    if (body.method === "tools/call" && body.params.name === "get_hotel_detail") {
      return rpcResponse(body.id, {
        content: [{
          type: "text",
          text: JSON.stringify({
            hotelId: "provider-1",
            bookingUrl: "https://booking.example/hotel-1",
            roomRatePlans: [
              {
                roomTypeId: "room-1",
                ratePlanId: "rate-1",
                roomNameCn: "湖景大床房",
                bedTypeDescription: "1 张 1.8 米大床",
                totalPrice: 1288,
                totalSalesRate: 644,
                inventoryCount: 2,
                isOnRequest: false,
                cancellationPolicies: [{ description: "入住前 1 天可免费取消" }],
              },
              {
                roomTypeId: "room-2",
                ratePlanId: "rate-2",
                roomNameCn: "已售罄房型",
                totalPrice: 999,
                inventoryCount: 0,
              },
            ],
          }),
        }],
      });
    }
    throw new Error(`Unexpected MCP request: ${body.method}`);
  };

  const client = createRollingGoHotelClient({
    apiKey: "secret-mcp-key",
    mcpUrl: "https://mcp.rollinggo.cn/mcp",
    timeoutMs: 2000,
  }, { fetchImpl });
  const search = await client.searchHotels({
    destination: "杭州",
    checkInDate: "2026-11-05",
    nights: 2,
    travelers: 2,
  });
  const detail = await client.hotelDetail({
    hotelId: search.hotels[0].providerHotelId,
    checkInDate: "2026-11-05",
    checkOutDate: "2026-11-07",
    rooms: 1,
    travelers: 2,
  });

  assert.equal(requests[0].url, "https://mcp.rollinggo.cn/mcp");
  assert.equal(requests[0].headers.Authorization, "Bearer secret-mcp-key");
  assert.equal(requests[2].headers["Mcp-Session-Id"], "session-123");
  assert.deepEqual(requests[3].body.params.arguments, {
    originQuery: "杭州 2晚 2人",
    place: "杭州 中国",
    placeType: "城市",
    size: 5,
    checkInParam: {
      checkInDate: "2026-11-05",
      stayNights: 2,
      adultCount: 2,
    },
  });
  assert.equal(search.hotels[0].name, "杭州西湖测试酒店");
  assert.equal(search.hotels[0].nightlyRate, 680);
  assert.equal(search.hotels[0].imageUrl, "https://images.example/hotel.jpg");
  assert.equal(detail.rooms[0].name, "湖景大床房");
  assert.equal(detail.rooms[0].totalPrice, 1288);
  assert.equal(detail.rooms[0].availability, "供应商可售");
  assert.equal(detail.rooms[1].availability, "已售罄");
  assert.equal(detail.rooms[1].isAvailable, false);
  assert.equal(detail.bookingUrl, "https://booking.example/hotel-1");
  assert.doesNotMatch(JSON.stringify({ search, detail }), /secret-mcp-key/);
});

test("RollingGo MCP reports missing and rejected credentials without exposing the key", async () => {
  let calls = 0;
  const client = createRollingGoHotelClient({
    apiKey: "",
    mcpUrl: "https://mcp.rollinggo.cn/mcp",
  }, { fetchImpl: async () => { calls += 1; throw new Error("must not fetch"); } });

  await assert.rejects(
    () => client.searchHotels({ destination: "杭州", checkInDate: "2026-11-05" }),
    (error) => error.code === "ROLLINGGO_AUTH_REQUIRED" && !error.message.includes("secret")
  );
  assert.equal(calls, 0);

  const rejected = createRollingGoHotelClient({
    apiKey: "not-valid",
    mcpUrl: "https://mcp.rollinggo.cn/mcp",
  }, {
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: "Unauthorized" } }), {
      status: 401,
      headers: { "content-type": "application/json" },
    }),
  });
  await assert.rejects(
    () => rejected.searchHotels({ destination: "杭州", checkInDate: "2026-11-05" }),
    (error) => error.code === "ROLLINGGO_AUTH_REQUIRED" && error.statusCode === 401
  );
});

test("room normalization computes stay totals and preserves confirmation and room details", () => {
  const room = normalizeRoomRatePlan({
    roomName: "家庭房",
    averagePrice: 750,
    isOnRequest: true,
    mealTypeStr: "含早餐",
    cancelPolicy: "入住前 1 天可免费取消",
    roomInfo: { hasWindow: true, maxOccupancy: 3, size: "32" },
  }, { nights: 2, rooms: 1 });
  assert.equal(room.availability, "需人工确认");
  assert.equal(room.isAvailable, true);
  assert.equal(room.totalPrice, 1500);
  assert.equal(room.nightlyPrice, 750);
  assert.equal(room.meal, "含早餐");
  assert.equal(room.roomWindow, true);
  assert.match(room.cancellation, /免费取消/);
  assert.equal(normalizeRollingGoHotel({ name: "酒店", imageUrl: "http://unsafe.example/a.jpg" }).imageUrl, null);
});
