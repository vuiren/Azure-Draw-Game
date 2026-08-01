using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using StackExchange.Redis;

namespace server.Hubs
{
    public class Point
    {
        public int X { get; set; }
        public int Y { get; set; }
    }

    public class Dot
    {
        public string ColorCode { get; set; } = "";
        public Point[] Points { get; set; } = Array.Empty<Point>();
    }

    public class DrawingHub(IConnectionMultiplexer connectionMultiplexer) : Hub
    {
        private readonly IDatabase _db = connectionMultiplexer.GetDatabase();
        private const string PointsKeyPrefix = "drawing:points:";
        private const string GeneralRoomName = "general";

        private static string GetRoomKey(string groupName) => PointsKeyPrefix + groupName;

        // ---------- Room management ----------

        public async Task JoinRoom(string roomName)
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, roomName);
        }

        public async Task LeaveRoom(string roomName)
        {
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomName);
        }

        public async Task ChangeGroup(string oldGroupName, string newGroupName)
        {
            await LeaveRoom(oldGroupName);
            await JoinRoom(newGroupName);
            await SendDotsToCaller(newGroupName);
        }

        // ---------- Drawing ----------

        public async Task ReceiveDot(string groupName, string colorCode, Point[] points)
        {
            var dot = new Dot { ColorCode = colorCode, Points = points };
            string json = JsonSerializer.Serialize(dot);

            // Append this stroke to the persistent list so late joiners can replay it
            await _db.ListRightPushAsync(GetRoomKey(groupName), json);

            await Clients.GroupExcept(groupName, Context.ConnectionId).SendAsync("ReceiveDot", colorCode, points);
        }

        public async Task UpdateUserPointer(string groupName, string userName, string colorCode, Point point)
        {
            await Clients.GroupExcept(groupName, Context.ConnectionId).SendAsync("UpdateUserPointer", userName, colorCode, point);
        }

        public async Task ClearCanvas(string groupName)
        {
            await _db.KeyDeleteAsync(GetRoomKey(groupName));
            await Clients.Group(groupName).SendAsync("ClearCanvas");
        }

        // ---------- Loading history ----------

        private async Task SendDotsToCaller(string groupName)
        {
            Dot[] dots = await LoadDots(groupName);
            await Clients.Caller.SendAsync("LoadDots", dots);
        }

        private async Task<Dot[]> LoadDots(string groupName)
        {
            RedisValue[] entries = await _db.ListRangeAsync(GetRoomKey(groupName));

            return entries
                .Select(entry => JsonSerializer.Deserialize<Dot>(entry.ToString()))
                .Where(dot => dot is not null)
                .Select(dot => dot!)
                .ToArray();
        }

        // ---------- Connection lifecycle ----------

        public override async Task OnConnectedAsync()
        {
            await JoinRoom(GeneralRoomName);
            await SendDotsToCaller(GeneralRoomName);

            await base.OnConnectedAsync();
        }
    }
}