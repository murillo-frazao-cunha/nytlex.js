/*
 * This file is part of the Nytlex.js Project.
 * Copyright (c) 2026 mfraz
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import React, { CSSProperties } from 'react';
import { processNytlexImage } from '../../image-utils.ts'; // Ajuste o caminho conforme necessário

interface NytlexImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
    src: any; // Alterado para 'any' para aceitar os imports dinâmicos descritos na sua lógica
    width?: number | string;
    height?: number | string;
    quality?: number;
    priority?: boolean;
}

const Image: React.FC<NytlexImageProps> = ({
                                               src,
                                               width,
                                               height,
                                               quality = 75,
                                               priority = false,
                                               className,
                                               style,
                                               alt = "",
                                               ...props
                                           }) => {

    // Processa toda a lógica através do utilitário comum
    const imageInfo = processNytlexImage(src, width, height, quality);

    if (!imageInfo.isValid) {
        return <></>;
    }

    const mergedStyle: CSSProperties = {
        ...imageInfo.style,
        ...style,
    };

    return (
        <img
            {...props}
            src={imageInfo.src}
            alt={alt}
            loading={priority ? 'eager' : 'lazy'}
            decoding={priority ? 'sync' : 'async'}
            width={imageInfo.widthAttr}
            height={imageInfo.heightAttr}
            className={`nytlex-image ${className || ''}`}
            style={mergedStyle}
        />
    );
};

export default Image;