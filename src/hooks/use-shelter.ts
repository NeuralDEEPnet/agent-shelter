import { useQuery } from "@tanstack/react-query";
import { client } from "@/lib/client";

export function useShelter() {
  return useQuery({ queryKey: ["shelter"], queryFn: () => client.getShelter(), staleTime: 20_000 });
}
