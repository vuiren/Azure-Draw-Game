import * as signalR from "@microsoft/signalr";

// ---------- Types ----------

type Point = { x: number; y: number };
type Dot = { colorCode: string; points: Point[] };

interface Elements {
    userNameInput: HTMLInputElement;
    groupNameInput: HTMLInputElement;
    changeGroupButton: HTMLInputElement;
    clearCanvasButton: HTMLInputElement;
    picker: HTMLInputElement;
    drawingCanvas: HTMLCanvasElement;
    drawingCtx: CanvasRenderingContext2D;
    cursorCanvas: HTMLCanvasElement;
    cursorCtx: CanvasRenderingContext2D;
    userListEl: HTMLUListElement;
}

// ---------- Config ----------

const API_BASE_URL = import.meta.env.VITE_API_URL;
const DOT_RADIUS = Number(import.meta.env.VITE_DOT_RADIUS);
const POINTS_SEND_INTERVAL_MS = Number(import.meta.env.VITE_POINTS_SEND_INTERVAL_MS);
const POINTER_SEND_INTERVAL_MS = Number(import.meta.env.VITE_POINTER_SEND_INTERVAL_MS);

// ---------- State ----------

let pointsTimeoutId = 0;
let pointerTimeoutId = 0;
let currentGroupName = "general";
let usersPointers: Record<string, { dotColor: string; point: Point, userName: string }> = {}; //key - connectionId
let roomUsers: Record<string, { userName: string; dotColor: string }> = {}; //key - connectionId



// ---------- Setup ----------

function renderLayout(root: HTMLElement) {
    root.innerHTML = `
    <div class="container">
        <div class="toolbar">
            <input type="text" id="userNameInput" value="someUser" placeholder="Enter your name" />
            <input type="text" id="groupNameInput" value="general" placeholder="Enter your room name" />
            <input type="button" id="changeGroupButton" value="Change Room" />
            <input type="button" id="clearCanvasButton" value="Clear Canvas" />
            <input type="color" id="picker" value="#000000">
        </div>

        <div class="workspace">
            <div class="canvas-wrapper">
                <canvas id="drawingCanvas" width="800" height="600"></canvas>
                <canvas id="cursorCanvas" width="800" height="600"></canvas>
            </div>

            <div class="sidebar">
                <h3>Connected Users</h3>
                <ul id="userList" class="user-list"></ul>
            </div>
        </div>
    </div>`;
}

function getElements(): Elements {
    const drawingCanvas = document.getElementById("drawingCanvas") as HTMLCanvasElement;
    const cursorCanvas = document.getElementById("cursorCanvas") as HTMLCanvasElement;

    return {
        userNameInput: document.getElementById("userNameInput") as HTMLInputElement,
        groupNameInput: document.getElementById("groupNameInput") as HTMLInputElement,
        changeGroupButton: document.getElementById("changeGroupButton") as HTMLInputElement,
        clearCanvasButton: document.getElementById("clearCanvasButton") as HTMLInputElement,
        picker: document.getElementById("picker") as HTMLInputElement,
        drawingCanvas,
        drawingCtx: drawingCanvas.getContext("2d") as CanvasRenderingContext2D,
        cursorCanvas,
        cursorCtx: cursorCanvas.getContext("2d") as CanvasRenderingContext2D,
        userListEl: document.getElementById("userList") as HTMLUListElement,
    };
}

function createConnection(): signalR.HubConnection {
    return new signalR.HubConnectionBuilder()
        .withUrl(`${API_BASE_URL}/drawingHub`, { withCredentials: true })
        .configureLogging(signalR.LogLevel.Information)
        .build();
}

// ---------- Drawing helpers ----------

function getPoint(rect: DOMRect, event: PointerEvent, canvas: HTMLCanvasElement): Point {
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    let x = (event.clientX - rect.left) * scaleX;
    let y = (event.clientY - rect.top) * scaleY;
    // Round and clamp to canvas bounds
    x = Math.min(Math.max(Math.round(x), 0), canvas.width - 1);
    y = Math.min(Math.max(Math.round(y), 0), canvas.height - 1);
    return { x, y };
}

function clearCanvas(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function drawDot(ctx: CanvasRenderingContext2D, x: number, y: number) {
    ctx.beginPath();
    ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
}

function drawWithStyle(ctx: CanvasRenderingContext2D, color: string, draw: () => void) {
    const originalFillStyle = ctx.fillStyle;
    ctx.fillStyle = color;
    draw();
    ctx.fillStyle = originalFillStyle;
}

function drawPointer(
    cursorCtx: CanvasRenderingContext2D,
    dotColor: string,
    point: Point,
    userName: string
) {
    drawWithStyle(cursorCtx, dotColor, () => drawDot(cursorCtx, point.x, point.y));

    if (userName) {
        cursorCtx.font = "12px sans-serif";
        cursorCtx.fillStyle = "#000000";
        cursorCtx.fillText(userName, point.x + 8, point.y - 8);
    }
}

function escapeHtml(value: string): string {
    const div = document.createElement("div");
    div.textContent = value;
    return div.innerHTML;
}

function renderUserList(userListEl: HTMLUListElement, selfConnectionId: string | null) {
    const entries = Object.entries(roomUsers);

    if (entries.length === 0) {
        userListEl.innerHTML = `<li class="user-list-empty">No one here yet</li>`;
        return;
    }

    userListEl.innerHTML = entries
        .map(([connectionId, { userName, dotColor }]) => {
            const isSelf = connectionId === selfConnectionId;
            const label = escapeHtml(userName || "Anonymous");
            return `
                <li class="${isSelf ? "self" : ""}">
                    <span class="user-color-dot" style="background:${dotColor}"></span>
                    <span>${label}${isSelf ? " (you)" : ""}</span>
                </li>`;
        })
        .join("");
}

function redrawAllPointers(cursorCanvas: HTMLCanvasElement, cursorCtx: CanvasRenderingContext2D) {
    cursorCtx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);
    for (const [, { dotColor, point, userName }] of Object.entries(usersPointers)) {
        drawPointer(cursorCtx, dotColor, point, userName);
    }
}


// ---------- Feature init ----------

function initDrawingCanvas(connection: signalR.HubConnection, el: Elements) {
    const { drawingCanvas: canvas, drawingCtx: ctx, groupNameInput, picker } = el;
    const pointsBuffer: Point[] = [];

    picker.addEventListener("input", () => {
        ctx.fillStyle = picker.value;
    });

    canvas.addEventListener("pointerdown", (event) => {
        if (event.buttons !== 1) return; // only draw while the primary button is held
        const rect = canvas.getBoundingClientRect();
        const point = getPoint(rect, event, canvas);
        drawDot(ctx, point.x, point.y);
        connection
            .invoke("ReceiveDot", groupNameInput.value, ctx.fillStyle, [point])
            .catch((err: Error) => console.error(err));
    });

    canvas.addEventListener("pointermove", (event) => {
        if (event.buttons !== 1) return; // only draw while the primary button is held
        const rect = canvas.getBoundingClientRect();
        const events = event.getCoalescedEvents?.() ?? [event];

        for (const e of events) {
            const point = getPoint(rect, e, canvas);
            drawDot(ctx, point.x, point.y);
            pointsBuffer.push(point);
        }

        clearTimeout(pointsTimeoutId);
        pointsTimeoutId = window.setTimeout(() => {
            if (pointsBuffer.length === 0) return;
            connection
                .invoke("ReceiveDot", groupNameInput.value, ctx.fillStyle, pointsBuffer)
                .catch((err: Error) => console.error(err));
            pointsBuffer.length = 0;
        }, POINTS_SEND_INTERVAL_MS);
    });

    connection.on("ReceiveDot", (dotColor: string, points: Point[]) => {
        drawWithStyle(ctx, dotColor, () => points.forEach(({ x, y }) => drawDot(ctx, x, y)));
    });

    connection.on("LoadDots", (dots: Dot[]) => {
        dots.forEach((dot) => {
            drawWithStyle(ctx, dot.colorCode, () =>
                dot.points.forEach((point) => drawDot(ctx, point.x, point.y))
            );
        });
    });
}

function initCursorCanvas(connection: signalR.HubConnection, el: Elements) {
    const { drawingCanvas, drawingCtx, cursorCanvas, cursorCtx, groupNameInput, userNameInput } = el;

    drawingCanvas.addEventListener("pointermove", (event) => {
        const rect = drawingCanvas.getBoundingClientRect();
        const point = getPoint(rect, event, drawingCanvas);
        if (connection.connectionId === null) return;
        usersPointers[connection.connectionId] = { dotColor: drawingCtx.fillStyle.toString(), point, userName: userNameInput.value };
        redrawAllPointers(cursorCanvas, cursorCtx);

        clearTimeout(pointerTimeoutId);
        pointerTimeoutId = window.setTimeout(() => {
            connection
                .invoke("UpdateUserPointer", groupNameInput.value, userNameInput.value, drawingCtx.fillStyle, point)
                .catch((err: Error) => console.error(err));
        }, POINTER_SEND_INTERVAL_MS);
    });

    connection.on("UpdateUserPointer", (connectionId: string, userName: string, dotColor: string, point: Point) => {
        usersPointers[connectionId] = { dotColor, point, userName };
        redrawAllPointers(cursorCanvas, cursorCtx);
    });

    connection.on("RemovePointer", (connectionId: string) => {
        delete usersPointers[connectionId];
        redrawAllPointers(cursorCanvas, cursorCtx);
    });
}

function initChangeGroup(connection: signalR.HubConnection, el: Elements) {
    const { changeGroupButton, groupNameInput, drawingCtx, drawingCanvas, cursorCtx, cursorCanvas, userListEl } = el;

    changeGroupButton.addEventListener("click", async () => {
        const oldGroupName = currentGroupName;
        currentGroupName = groupNameInput.value;

        clearTimeout(pointsTimeoutId);
        clearTimeout(pointerTimeoutId);
        clearCanvas(drawingCtx, drawingCanvas);
        clearCanvas(cursorCtx, cursorCanvas);

        roomUsers = {};
        usersPointers = {};
        renderUserList(userListEl, connection.connectionId);

        await connection
            .invoke("ChangeGroup", oldGroupName, currentGroupName)
            .catch((err: Error) => console.error(err));
    });
}

function initUserList(connection: signalR.HubConnection, el: Elements) {
    const { userListEl, userNameInput, picker, drawingCtx } = el;

    const refresh = () => renderUserList(userListEl, connection.connectionId);

    userNameInput.addEventListener("input", () => {
        if (!connection.connectionId) return;
        const existing = roomUsers[connection.connectionId];
        roomUsers[connection.connectionId] = {
            dotColor: existing?.dotColor ?? drawingCtx.fillStyle.toString(),
            userName: userNameInput.value,
        };
        refresh();
    });

    picker.addEventListener("input", () => {
        if (!connection.connectionId) return;
        const existing = roomUsers[connection.connectionId];
        roomUsers[connection.connectionId] = {
            userName: existing?.userName ?? userNameInput.value,
            dotColor: picker.value,
        };
        refresh();
    });

    connection.on("UpdateUserPointer", (connectionId: string, userName: string, dotColor: string) => {
        const oldRecord = roomUsers[connectionId] || { userName: "", dotColor: "" };
        if (oldRecord.userName === userName && oldRecord.dotColor === dotColor) return; // no change

        roomUsers[connectionId] = { userName, dotColor };
        refresh();
    });

    connection.on("RemovePointer", (connectionId: string) => {
        delete roomUsers[connectionId];
        refresh();
    });

    connection.on("JoinedRoom", (connectionId: string) => {
        roomUsers[connectionId] = { userName: userNameInput.value, dotColor: drawingCtx.fillStyle.toString() };
        refresh();
    });

    connection.on("LeftRoom", (connectionId: string) => {
        delete roomUsers[connectionId];
        refresh();
    });

    refresh();
}

function initClearCanvas(connection: signalR.HubConnection, el: Elements) {
    const { clearCanvasButton, drawingCtx, drawingCanvas } = el;

    clearCanvasButton.addEventListener("click", () => {
        clearCanvas(drawingCtx, drawingCanvas);
        connection.invoke("ClearCanvas", currentGroupName).catch((err: Error) => console.error(err));
    });

    connection.on("ClearCanvas", () => {
        clearCanvas(drawingCtx, drawingCanvas);
    });
}

// ---------- Entry point ----------

function initDrawing() {
    const appRoot = document.querySelector<HTMLDivElement>("#app");
    if (!appRoot) throw new Error("#app root not found");

    renderLayout(appRoot);
    const el = getElements();
    const connection = createConnection();

    initDrawingCanvas(connection, el);
    initCursorCanvas(connection, el);
    initChangeGroup(connection, el);
    initClearCanvas(connection, el);
    initUserList(connection, el);

    connection
        .start()
        .then(() => console.log("Connection started"))
        .catch((err: Error) => console.error(err));
}

document.addEventListener("DOMContentLoaded", initDrawing);