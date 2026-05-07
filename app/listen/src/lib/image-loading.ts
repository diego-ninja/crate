type ImageFetchPriority = "high" | "low" | "auto";
type PriorityImage = HTMLImageElement & { fetchPriority: ImageFetchPriority };

export function setImageFetchPriority(
  image: HTMLImageElement,
  priority: ImageFetchPriority,
): boolean {
  if (!("fetchPriority" in image)) {
    return false;
  }

  (image as PriorityImage).fetchPriority = priority;
  return true;
}
