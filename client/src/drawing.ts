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
const usersPointers: Record<string, { dotColor: string; point: Point }> = {};



// ---------- Setup ----------

function renderLayout(root: HTMLElement) {
    root.innerHTML = `
    <div class="container">
        <input type="text" id="userNameInput" value="someUser" placeholder="Enter your name" />
        <input type="text" id="groupNameInput" value="general" placeholder="Enter your room name" />
        <input type="button" id="changeGroupButton" value="Change Room" />
        <input type="button" id="clearCanvasButton" value="Clear canvas" />
        <input type="color" id="picker" value="#000000">
        <div style="position: relative; width: 800px; height: 600px;">
            <canvas id="drawingCanvas" width="800" height="600"
                style="border:1px solid #000000; position: absolute; top:0; left:0;"></canvas>
            <canvas id="cursorCanvas" width="800" height="600"
                style="position: absolute; top:0; left:0; pointer-events: none;"></canvas>
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
    };
}

function createConnection(): signalR.HubConnection {
    return new signalR.HubConnectionBuilder()
        .withUrl(`${API_BASE_URL}/drawingHub`, { withCredentials: true })
        .configureLogging(signalR.LogLevel.Information)
        .build();
}

// ---------- Drawing helpers ----------

function getPoint(event: PointerEvent, canvas: HTMLCanvasElement): Point {
    const rect = canvas.getBoundingClientRect();
    return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
    };
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
    cursorCanvas: HTMLCanvasElement,
    cursorCtx: CanvasRenderingContext2D,
    dotColor: string,
    point: Point,
    userName: string
) {
    cursorCtx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);
    drawWithStyle(cursorCtx, dotColor, () => drawDot(cursorCtx, point.x, point.y));

    if (userName) {
        cursorCtx.font = "12px sans-serif";
        cursorCtx.fillStyle = "#000000";
        cursorCtx.fillText(userName, point.x + 8, point.y - 8);
    }
}

// ---------- Feature init ----------

function initDrawingCanvas(connection: signalR.HubConnection, el: Elements) {
    const { drawingCanvas: canvas, drawingCtx: ctx, groupNameInput, picker } = el;
    const pointsBuffer: Point[] = [];

    picker.addEventListener("input", () => {
        ctx.fillStyle = picker.value;
    });

    canvas.addEventListener("pointermove", (event) => {
        if (event.buttons !== 1) return; // only draw while the primary button is held

        const events = event.getCoalescedEvents?.() ?? [event];

        for (const e of events) {
            const point = getPoint(e, canvas);
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

function redrawAllPointers(cursorCanvas: HTMLCanvasElement, cursorCtx: CanvasRenderingContext2D) {
    cursorCtx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);
    for (const [userName, { dotColor, point }] of Object.entries(usersPointers)) {
        drawPointer(cursorCanvas, cursorCtx, dotColor, point, userName);
    }
}

function initCursorCanvas(connection: signalR.HubConnection, el: Elements) {
    const { drawingCanvas, drawingCtx, cursorCanvas, cursorCtx, groupNameInput, userNameInput } = el;

    drawingCanvas.addEventListener("pointermove", (event) => {
        const point = getPoint(event, drawingCanvas);
        usersPointers[userNameInput.value] = { dotColor: drawingCtx.fillStyle.toString(), point };
        redrawAllPointers(cursorCanvas, cursorCtx);

        clearTimeout(pointerTimeoutId);
        pointerTimeoutId = window.setTimeout(() => {
            connection
                .invoke("UpdateUserPointer", groupNameInput.value, userNameInput.value, drawingCtx.fillStyle, point)
                .catch((err: Error) => console.error(err));
        }, POINTER_SEND_INTERVAL_MS);
    });

    connection.on("UpdateUserPointer", (userName: string, dotColor: string, point: Point) => {
        usersPointers[userName] = { dotColor, point };
        redrawAllPointers(cursorCanvas, cursorCtx);
    });
}

function initChangeGroup(connection: signalR.HubConnection, el: Elements) {
    const { changeGroupButton, groupNameInput, drawingCtx, drawingCanvas, cursorCtx, cursorCanvas } = el;

    changeGroupButton.addEventListener("click", async () => {
        const oldGroupName = currentGroupName;
        currentGroupName = groupNameInput.value;

        clearTimeout(pointsTimeoutId);
        clearTimeout(pointerTimeoutId);
        clearCanvas(drawingCtx, drawingCanvas);
        clearCanvas(cursorCtx, cursorCanvas);

        await connection
            .invoke("ChangeGroup", oldGroupName, currentGroupName)
            .catch((err: Error) => console.error(err));
    });
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

    connection
        .start()
        .then(() => console.log("Connection started"))
        .catch((err: Error) => console.error(err));
}

document.addEventListener("DOMContentLoaded", initDrawing);