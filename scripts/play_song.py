import pygame
from pathlib import Path
import sys
import librosa
import time

class ProjectPaths:
  def __init__(self):
    self.script_dir = Path(__file__).parent
    self.project_root = self.script_dir.parent
    self.assets_dir = self.project_root / "assets"
    self.vocals_dir = self.assets_dir / "reference_vocals"
    self.instrumental_dir = self.assets_dir / "reference_instrumental"
    self.recordings_dir = self.project_root / "recordings"
    self.cache_dir = self.project_root / "cache"
    
    self.recordings_dir.mkdir(exist_ok=True)
    self.cache_dir.mkdir(exist_ok=True)

    self.sample_rate = 44100
    pygame.mixer.init(frequency=self.sample_rate, size=-16, channels=2)

def main():
  print("Script to play song is called!!!!!!!!!!!!!!!")

  paths = ProjectPaths()
  # Define available songs
  songs = {
      "diewithasmile": {
          "vocals": paths.vocals_dir / "DieWithASmile_Vocal.wav",
          "instrumental": paths.instrumental_dir / "DieWithASmile_Instrumental.wav"
      },
      "testsong": {
          "vocals": paths.vocals_dir / "trimmed_DQV.wav",
          "instrumental": paths.instrumental_dir / "trimmed_DQI.wav"
      }
  }

  if len(sys.argv) < 2:
    print("Error: Missing song ID argument.")
    sys.exit(1)

  song_key = sys.argv[1]
  if song_key not in songs:
    print(f"Error: Song '{song_key}' not found.")
    sys.exit(1)

  instrumental_path = songs[song_key]["instrumental"]
  duration = librosa.get_duration(path=str(instrumental_path))

  pygame.mixer.music.load(str(instrumental_path))
  pygame.mixer.music.play()

  time.sleep(int(duration))

  pygame.mixer.quit()
  pygame.quit()

if __name__ == "__main__":
  main()