import os

# Mapping class dari COCO ke class custom kamu
label_mapping = {
    2: 0,  # Mobil
    3: 1,  # Motor
    5: 2,  # Bus
    7: 3   # Truk
}

def remap_labels_in_folder(folder_path):
    for file_name in os.listdir(folder_path):
        if not file_name.endswith('.txt'):
            continue

        file_path = os.path.join(folder_path, file_name)
        with open(file_path, 'r') as f:
            lines = f.readlines()

        new_lines = []
        for line in lines:
            parts = line.strip().split()
            if len(parts) < 5:
                continue
            class_id = int(parts[0])
            if class_id in label_mapping:
                new_class_id = label_mapping[class_id]
                new_line = f"{new_class_id} {' '.join(parts[1:])}\n"
                new_lines.append(new_line)

        # Overwrite dengan label yang sudah dimapping
        with open(file_path, 'w') as f:
            f.writelines(new_lines)

# Ganti path ini ke lokasi folder labels kamu
base_path = r'C:\Car Detection\vehicledetect\dataset\labels'
remap_labels_in_folder(os.path.join(base_path, 'train'))
remap_labels_in_folder(os.path.join(base_path, 'val'))

print("✅ Semua label sudah dimapping ulang.")
