from rembg import remove
from PIL import Image

def remove_background(input_path, output_path):
    input = Image.open(input_path)
    output = remove(input)
    output.save(output_path)

if __name__ == "__main__":
    remove_background("3CA10201-5DA6-4304-82F8-CB16B67BD31A_1_105_c.jpeg", "output.png")
