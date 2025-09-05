// src/main.rs

use macroquad::prelude::*;

// --- Game Constants ---
// This is our new bridge between the grid and pixels!
const TILE_SIZE: f32 = 32.0;

// here in the terminal version we used the crossterm crate
// apart from that the basic game structure remains the same

// player defination
struct Player {
    x: usize,
    y: usize,
}

// the game defination
struct Game {
    map: Vec<Vec<char>>,
    player: Player,
    score: u32,
    pellets: u32,
}


// the game implimentation
// implimenting the game logic here

impl Game {
    fn new() -> Self {
        let map_str = vec![
            "########################",
            "#P........##...........#",
            "#.####.###..###.####...#",
            "#......................#",
            "#.####.#.######.#.####.#",
            "#......#...##...#......#",
            "########################",
        ];

        let map: Vec<Vec<char>> = map_str.iter().map(|s| s.chars().collect()).collect();

        // logic similar to the terminal version
        // player start pos set to 0
        let mut start_x = 0;
        let mut start_y = 0;
        let mut pellets = 0;

        // loop that itterates over the map
        for (y, row) in map.iter().enumerate() {
            for (x, &char) in row.iter().enumerate() {
                if char == 'P' {
                    start_x = x;
                    start_y = y;
                }
                if char == '.' {
                    pellets += 1;
                }
            }
        }

        Game {
            map,
            player: Player { x: start_x, y: start_y },
            score: 0,
            pellets,
        }
    }

    // the core move logic is similar, but simpler.
    // we no longer need to write 'P' into the map grid.
    fn move_player(&mut self, dx: i32, dy: i32) {
        let new_x = (self.player.x as i32 + dx) as usize;
        let new_y = (self.player.y as i32 + dy) as usize;

        if self.map[new_y][new_x] != '#' {
            // if the player and the pallet overlap the player eats the pallet
            if self.map[new_y][new_x] == '.' {
                self.score += 10;
                self.pellets -= 1;
                self.map[new_y][new_x] = ' '; // Erase the pellet
            }
            // Update player's position in the struct.
            self.player.x = new_x;
            self.player.y = new_y;
        }
    }

    /// This function will contain all our per-frame logic.
    fn update(&mut self) {
        // Macroquad's key detection is simple and great for games.
        if is_key_pressed(KeyCode::Right) {
            self.move_player(1, 0);
        }
        if is_key_pressed(KeyCode::Left) {
            self.move_player(-1, 0);
        }
        if is_key_pressed(KeyCode::Up) {
            self.move_player(0, -1);
        }
        if is_key_pressed(KeyCode::Down) {
            self.move_player(0, 1);
        }
    }

    /// This is our new drawing function.
    /// we use this fn to make our map
    fn draw(&self) {
        // clear the background to black on every frame.
        clear_background(BLACK);

        // draw the map by iterating through our grid.
        for (y, row) in self.map.iter().enumerate() {
            for (x, &char) in row.iter().enumerate() {
                // convert grid coordinates to pixel coordinates.
                let pos_x = x as f32 * TILE_SIZE;
                let pos_y = y as f32 * TILE_SIZE;

                match char {
                    '#' => draw_rectangle(pos_x, pos_y, TILE_SIZE, TILE_SIZE, BLUE),
                    '.' => draw_circle(pos_x + TILE_SIZE / 2.0, pos_y + TILE_SIZE / 2.0, 4.0, WHITE),
                    _ => {}
                }
            }
        }

        // creating the player
        draw_circle(
            self.player.x as f32 * TILE_SIZE + TILE_SIZE / 2.0, // Center of the tile
            self.player.y as f32 * TILE_SIZE + TILE_SIZE / 2.0, // Center of the tile
            TILE_SIZE / 2.0 - 2.0, // Make radius slightly smaller than tile
            YELLOW,
        );

        // draw the score text.
        draw_text(&format!("Score: {}", self.score), 20.0, 20.0, 30.0, WHITE);
        
        if self.pellets == 0 {
             let text = "You Win!";
             let text_size = measure_text(text, None, 50, 1.0);
             draw_text(
                text,
                screen_width() / 2.0 - text_size.width / 2.0,
                screen_height() / 2.0,
                50.0,
                YELLOW,
            );
        }
    }
}

// Macroquad requires a configuration function to set the window title and size.
fn window_conf() -> Conf {
    Conf {
        window_title: "Pac-Man".to_owned(),
        // We calculate the window size based on our map dimensions and tile size.
        window_width: (24 * TILE_SIZE as i32), // map width
        window_height: (7 * TILE_SIZE as i32),  // map height
        ..Default::default()
    }
}

// This attribute tells Rust to use Macroquad's main function.
#[macroquad::main(window_conf)]
async fn main() {
    let mut game = Game::new();

    // This is the main game loop that runs 60 times per second.
    loop {
        // Logic update (input, movement)
        if game.pellets > 0 {
             game.update();
        }

        // Drawing
        game.draw();

        // This tells Macroquad to finish the current frame and wait for the next.
        next_frame().await
    }
}