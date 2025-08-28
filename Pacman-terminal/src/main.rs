use std::io::{stdout, Stdout, Write};
use std::time::Duration;
use std::thread;

//the std io is for the standard input and output
//std::time we are using to controll the time in the game
//using the time and the thread we can make the game pause for short durations


//for the interaction with the terminal we use crosstream.
use crossterm::{
    cursor::{Hide, MoveTo, Show},  //used to hide and show the terminal cursor
    event::{poll, read, Event, KeyCode},  //to read keyboard events
    execute,                              // enables us to run many helper commands at once
    terminal::{disable_raw_mode, enable_raw_mode, Clear, ClearType}  //to control the teminal in genral
};

//the player defination
struct Player{
    x: usize,
    y: usize
}

//the game defiation
struct Game{
    map: Vec<Vec<char>>,  //to represent a 2D game board
    player: Player, 
    score: u32,
    pallets: u32
}

// implimenting the game logic here, giving the game the bacic "how to"
impl Game{
    fn new() -> Self{
        let map_str = vec![
            "####################",
            "#P........##........#",
            "#.####.###..###.####.#",
            "#..................#",
            "#.####.#.######.#.####.#",
            "#......#...##...#......#",
            "####################",
        ];

        let map: Vec<Vec<char>> = map_str.iter().map(|s|s.chars().collect()).collect();

        //setting the start position of the player and the pellet count to 0
        let mut start_x = 0;
        let mut start_y = 0;
        let mut pallets = 0;

        //
        for (y, row) in map.iter().enumerate(){
            for (x, &char) in row.iter().enumerate(){
                if char == 'P'{
                    start_x = x;
                    start_y = y;
                }
                if char == '.'{
                    pallets += 1;
                }
            }
        }

        Game { map, player: Player { x: start_x, y: start_y }, score: 0, pallets }
    }

    //fn to move the player within the bounds of the walls and collect pellets
    fn move_player (&mut self , dx: i32, dy: i32){
        let new_x = (self.player.x as i32 + dx) as usize;
        let new_y = (self.player.y as i32 + dy) as usize;


        if self.map[new_y][new_x] != '#' {  //checking for a wall
            if self.map[new_y][new_x] == "."{  //checking for pellets
                self.score += 10;
                self.pallets -= 1;
            }

            self.map[self.player.y][self.player.x] = ' ';  //this clears the players last position

            //updating the players position
            self.player.x = new_x;
            self.player.y = new_y;

            self.map[self.player.y][self.player.x] = 'P';  //moving the player to the newer position in the map
        }
    }
}

//drawing the game on the terminal
fn draw(Stdout: &mut std::io::Stdout, game: &Game){

    //clearing the screen and movng the cursor to the top left
    execute!(Stdout, Clear(ClearType::All), MoveTo(0, 0)).unwrap();

    //drawing the map each row at a time
    for row in &game.map{
        let line: String = row.iter().collect();  // turns the char in row into string
        println!("{}\r", line);  //the \r moves the cursor to the begining of the current line
    }

    //the score and the remiaing pallets
    println!("Score: {}\r", game.score);
    println!("pellets: {}\r", game.pallets);

    if game.pallets == 0 {
        println!("YOU WIN !!!");
    }

    Stdout.flush().unwrap();
}

fn main() {
    println!("Hello, world!");
}
