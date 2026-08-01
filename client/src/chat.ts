import * as signalR from "@microsoft/signalr";

function renderLayout(root: HTMLElement) {
  root.innerHTML = `
    <div class="container">
      <div class="row p-1">
        <div class="col-1">User</div>
        <div class="col-5"><input type="text" id="userInput" /></div>
      </div>
      <div class="row p-1">
        <div class="col-1">Message</div>
        <div class="col-5"><input type="text" class="w-100" id="messageInput" /></div>
      </div>
      <div class="row p-1">
        <div class="col-6 text-end">
          <input type="button" id="sendButton" value="Send Message" />
        </div>
      </div>
      <div class="row p-1"><div class="col-6"><hr /></div></div>
      <div class="row p-1"><div class="col-6"><ul id="messagesList"></ul></div></div>
    </div>`;
}

function initChat() {
  const appRoot = document.querySelector<HTMLDivElement>('#app');
  if (!appRoot) throw new Error("#app root not found");
  renderLayout(appRoot); // elements now guaranteed to exist

  const apiBaseUrl = "http://127.0.0.1:5296";
  const connection = new signalR.HubConnectionBuilder()
    .withUrl(`${apiBaseUrl}/chatHub`)
    .configureLogging(signalR.LogLevel.Information)
    .build();

  const sendButton = document.getElementById("sendButton") as HTMLButtonElement;
  const userInput = document.getElementById("userInput") as HTMLInputElement;
  const messageInput = document.getElementById("messageInput") as HTMLInputElement;
  const messagesList = document.getElementById("messagesList") as HTMLUListElement;

  sendButton.disabled = true;

  connection.on("ReceiveMessage", (user: string, message: string) => {
    const li = document.createElement("li");
    li.textContent = `${user} says ${message}`;
    messagesList.appendChild(li);
  });

  connection.start()
    .then(() => { sendButton.disabled = false; })
    .catch((err: Error) => console.error(err));

  sendButton.addEventListener("click", (event) => {
    event.preventDefault();
    const user = userInput.value;
    const message = messageInput.value;
    connection.invoke("SendMessage", user, message)
      .catch((err: Error) => console.error(err));
  });
}

document.addEventListener('DOMContentLoaded', initChat);