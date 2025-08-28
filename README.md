# Pacman-Terminal

A simple Pacman game that runs in the terminal, written in Rust.

## Features

*   Navigate Pacman through a maze.
*   Collect all the pellets to win.
*   Avoid the walls.
*   Score tracking.

## Installation

1.  Clone the repository.
2.  Navigate to the project directory:
    ```bash
    cd Pacman-terminal
    ```
3.  Build the project:
    ```bash
    cargo build --release
    ```
4.  Run the game:
    ```bash
    cargo run
    ```

## Usage

*   Use the arrow keys or 'w', 'a', 's', 'd' to move Pacman.
*   'q' or 'Esc' to quit the game.

## Future Plans

*   Version 2 will feature a GUI implementation using Rust.

## Dependencies

*   crossterm = "0.27"
