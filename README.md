# 🦀 Rust-Pacman 👾

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A classic Pacman game clone built with Rust. This repository contains two distinct versions of the game: a retro-style terminal version and a modern graphical version.

![A GIF showing both the terminal and graphical versions of the game in action.](https://github.com/user-attachments/assets/7ac2f5a8-ac3a-4422-b5e1-d601d2932f91)


## ✨ Features

* **Classic Pacman Gameplay**: Navigate the maze, eat pellets, and avoid the ghosts!
* **Two Versions**:
    * **v1 (Terminal)**: A lightweight, retro experience that runs directly in your command line.
    * **v2 (Graphical)**: A full-fledged graphical version with sprites and a smooth interface.
* **Scoring System**: Rack up points for eating pellets and ghosts.
* **Power Pellets**: Turn the tables on the ghosts and chase them down!
* **Pure Rust**: Built entirely in Rust for performance and safety.

***

## 🎮 Project Versions

This project is split into two main versions, each in its own directory.

### Version 1: Terminal Edition

This version runs directly in your terminal, using characters to render the game world. It's a fun, minimalist take on the classic.

* **Location**: `/v1-terminal` (Please update this path if it's different!)
* **UI Library**: Probably `crossterm` or `termion`.

### Version 2: Graphical Edition

This is a modern implementation with a graphical user interface (GUI), featuring sprites for Pacman, the ghosts, and the maze.

* **Location**: `/v2-graphical` (Please update this path if it's different!)
* **Graphics Engine**: You can specify the engine you used, for example: `Bevy`, `ggez`, or `macroquad`.

***

## 🚀 Getting Started

Follow these instructions to get a copy of the project up and running on your local machine.

### Prerequisites

You need to have **Rust** and its package manager, **Cargo**, installed. If you don't have them, you can install them easily with `rustup`.

```sh
# Installs rustup, which manages Rust versions and tools
curl --proto '=https' --tlsv1.2 -sSf [https://sh.rustup.rs](https://sh.rustup.rs) | sh
```
Follow the on-screen instructions after running the command.

### Installation & Running

1.  **Clone the repository:**
    ```sh
    git clone [https://github.com/JoshhSandhu/Rust-Pacman.git](https://github.com/JoshhSandhu/Rust-Pacman.git)
    ```

2.  **Navigate into the project directory:**
    ```sh
    cd Rust-Pacman
    ```

3.  **Run the version you want to play:**

    * **To run the Terminal version (v1):**
        ```sh
        # Navigate to the terminal version's directory
        cd v1-terminal  # <-- Make sure this is the correct folder name

        # Build and run the project in release mode for best performance
        cargo run --release
        ```

    * **To run the Graphical version (v2):**
        ```sh
        # Navigate to the graphical version's directory
        cd v2-graphical # <-- Make sure this is the correct folder name

        # Build and run the project in release mode
        cargo run --release
        ```

***

## 🕹️ How to Play

The goal is to clear the maze of all pellets without getting caught by the ghosts!

* **Controls**:
    * **Move Up**: `Up Arrow` or `W`
    * **Move Down**: `Down Arrow` or `S`
    * **Move Left**: `Left Arrow` or `A`
    * **Move Right**: `Right Arrow` or `D`
    * **Quit**: `Esc` or `Q`

* **Items**:
    * **Pellet (`.`):** Eat these to score points.
    * **Power Pellet (`o`):** Eating one of these makes the ghosts vulnerable for a short time, allowing you to eat them for extra points!

***

## 🛠️ Built With

* [**Rust**](https://www.rust-lang.org/) - The core programming language.
* **[Your Terminal Library Here, e.g., `crossterm`]** - For the terminal version's UI.
* **[Your GUI Framework Here, e.g., `Bevy`]** - For the graphical version.

***

## 📝 Future Improvements

Here are some ideas for future development:

- [ ] High score tracking and saving.
- [ ] Multiple levels with increasing difficulty.
- [ ] More intelligent ghost AI (Blinky, Pinky, Inky, and Clyde behaviors).
- [ ] Sound effects and music.

***

## 🤝 Contributing

Contributions are what make the open-source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

1.  Fork the Project
2.  Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3.  Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4.  Push to the Branch (`git push origin feature/AmazingFeature`)
5.  Open a Pull Request

***

## 📄 License

This project is distributed under the MIT License. See the `LICENSE` file for more information.
