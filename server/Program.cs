using server.Hubs;
using StackExchange.Redis;

namespace server
{
    public class Program
    {
        public static void Main(string[] args)
        {
            var builder = WebApplication.CreateBuilder(args);

            // Add services to the container.

            builder.Services.AddControllers();
            // Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
            builder.Services.AddOpenApi();

            var signalRBuilder = builder.Services.AddSignalR();

            var signalRConnectionString = builder.Configuration.GetConnectionString("SignalR")!;
            if (!string.IsNullOrEmpty(signalRConnectionString))
            {
                signalRBuilder.AddAzureSignalR(signalRConnectionString);
            }

            var allowedOrigins = builder.Configuration
                .GetSection("Cors:AllowedOrigins")
                .Get<string[]>() ?? Array.Empty<string>();

            builder.Services.AddCors(options =>
            {
                options.AddPolicy("ClientPolicy", policy =>
                {
                    policy.WithOrigins(allowedOrigins)
                          .AllowAnyHeader()
                          .AllowAnyMethod()
                          .AllowCredentials(); // required for SignalR
                });
            });

            builder.Services.AddSingleton<IConnectionMultiplexer>(
                ConnectionMultiplexer.Connect(builder.Configuration.GetConnectionString("Redis")!));

            var app = builder.Build();

            app.UseCors("ClientPolicy");

            // Configure the HTTP request pipeline.
            if (app.Environment.IsDevelopment())
            {
                app.MapOpenApi();
            }

            app.UseHttpsRedirection();
            app.MapHub<DrawingHub>("/drawingHub").RequireCors("ClientPolicy");
            app.UseAuthorization();


            app.MapControllers();

            app.Run();
        }
    }
}
