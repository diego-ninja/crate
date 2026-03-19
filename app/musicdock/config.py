import os
import yaml


def load_config(path=None):
    if path is None:
        path = os.environ.get("MUSICDOCK_CONFIG", "/app/config.yaml")

    with open(path) as f:
        config = yaml.safe_load(f)

    return config
